const DEFAULT_MAX_ATTEMPTS = 5;
const IMAGE_MIN_START_INTERVAL_MS = 8_000;
const MAX_BACKOFF_MS = 75_000;

let imageStartQueue: Promise<void> = Promise.resolve();
let lastImageStartAt = 0;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function parseDuration(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1_000;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(trimmed);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (match[2] === "ms") return amount;
  if (match[2] === "s") return amount * 1_000;
  return amount * 60_000;
}

function retryDelay(response: Response | null, attempt: number) {
  const retryAfter = parseDuration(response?.headers.get("retry-after") ?? null);
  const resetRequests = parseDuration(response?.headers.get("x-ratelimit-reset-requests") ?? null);
  const resetImages = parseDuration(response?.headers.get("x-ratelimit-reset-images") ?? null);
  const hinted = Math.max(retryAfter ?? 0, resetRequests ?? 0, resetImages ?? 0);
  if (hinted > 0) return Math.min(MAX_BACKOFF_MS, hinted + 1_000);
  const exponential = 8_000 * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 2_500);
  return Math.min(MAX_BACKOFF_MS, exponential + jitter);
}

async function waitForImageStartSlot() {
  const previous = imageStartQueue;
  let release!: () => void;
  imageStartQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const elapsed = Date.now() - lastImageStartAt;
    if (elapsed < IMAGE_MIN_START_INTERVAL_MS) await sleep(IMAGE_MIN_START_INTERVAL_MS - elapsed);
    lastImageStartAt = Date.now();
  } finally {
    release();
  }
}

type ProviderError = {
  message: string;
  type: string;
  code: string;
};

async function readProviderError(response: Response): Promise<ProviderError> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown; type?: unknown; code?: unknown } };
    return {
      message: String(parsed.error?.message ?? "").trim(),
      type: String(parsed.error?.type ?? "").trim(),
      code: String(parsed.error?.code ?? "").trim(),
    };
  } catch {
    return { message: text.slice(0, 500), type: "", code: "" };
  }
}

function isQuotaFailure(error: ProviderError) {
  const fingerprint = `${error.code} ${error.type} ${error.message}`.toLowerCase();
  return fingerprint.includes("insufficient_quota") ||
    fingerprint.includes("billing") ||
    fingerprint.includes("quota") && !fingerprint.includes("rate limit");
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isTransientVisualError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes("quota de génération api insuffisant")) return false;
  if (message.includes("invalid_api_key") || message.includes("incorrect api key") || message.includes("unauthorized")) return false;
  return /\((408|409|429|500|502|503|504)\)/.test(message)
    || message.includes("temporairement saturé")
    || message.includes("rate limit")
    || message.includes("too many requests")
    || message.includes("timeout")
    || message.includes("timed out")
    || message.includes("aborted")
    || message.includes("fetch failed")
    || message.includes("network error")
    || message.includes("econnreset")
    || message.includes("econnrefused");
}

export type PilotPaperOpenAiRequestOptions = {
  label: string;
  imageGeneration?: boolean;
  maxAttempts?: number;
};

/**
 * Executes one provider request with PilotPaper-owned resilience.
 * The init factory is rebuilt on every attempt so FormData and AbortSignal are always fresh.
 */
export async function pilotPaperOpenAiRequest(
  url: string,
  initFactory: () => RequestInit,
  options: PilotPaperOpenAiRequestOptions,
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let lastStatus: number | null = null;
  let lastError: ProviderError = { message: "", type: "", code: "" };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.imageGeneration) await waitForImageStartSlot();

    let response: Response | null = null;
    try {
      response = await fetch(url, initFactory());
      lastStatus = response.status;
      if (response.ok) return response;

      lastError = await readProviderError(response);
      if (response.status === 429 && isQuotaFailure(lastError)) {
        throw new Error("Quota de génération API insuffisant. Vérifiez les crédits ou la facturation associés à la clé API locale de PilotPaper.");
      }

      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        if (response.status === 429) {
          throw new Error(`${options.label} temporairement saturé (429) malgré ${maxAttempts} tentatives automatiques. Réessayez dans quelques minutes.`);
        }
        throw new Error(`${options.label} indisponible (${response.status}).`);
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes("Quota de génération API") || error.message.includes("malgré") || /indisponible \(\d+\)/.test(error.message))) {
        throw error;
      }
      if (attempt === maxAttempts) {
        const suffix = lastStatus ? ` (${lastStatus})` : "";
        throw new Error(`${options.label} indisponible${suffix} après ${maxAttempts} tentatives automatiques.`);
      }
    }

    await sleep(retryDelay(response, attempt));
  }

  const detail = lastError.code || lastError.type || String(lastStatus ?? "inconnu");
  throw new Error(`${options.label} indisponible (${detail}).`);
}

/**
 * Protects the whole visual DP job against transient provider/network failures produced anywhere
 * in the renderer or inspector. Geometry/quality failures are never retried as if they were network errors.
 */
export async function pilotPaperRunVisualJob<T>(label: string, task: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForImageStartSlot();
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isTransientVisualError(error)) throw error;
      if (attempt === maxAttempts) {
        throw new Error(`${label} : moteur visuel temporairement indisponible après ${maxAttempts} reprises automatiques. Réessayez dans quelques minutes.`);
      }
      await sleep(Math.min(MAX_BACKOFF_MS, 10_000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 2_000)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} indisponible.`);
}

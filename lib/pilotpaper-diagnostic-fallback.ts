import { getDpPieceContract } from "@/lib/dp-piece-contract";
import { pilotPaperOpenAiRequest } from "@/lib/pilotpaper-openai-resilience";
import type { DPNumber, DpPieceInput, DpPieceOutput, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";

const IGN_WMS_ENDPOINT = "https://data.geopf.fr/wms-r/wms";
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;

function toWebMercator(longitude: number, latitude: number) {
  const boundedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return {
    x: (longitude * WEB_MERCATOR_LIMIT) / 180,
    y: (Math.log(Math.tan(((90 + boundedLatitude) * Math.PI) / 360)) * WEB_MERCATOR_LIMIT) / Math.PI,
  };
}

async function dp2Source(address: string): Promise<PiecePhotoInput> {
  const search = new URL("https://data.geopf.fr/geocodage/search");
  search.searchParams.set("q", address.trim());
  search.searchParams.set("index", "address");
  search.searchParams.set("limit", "1");
  const geocode = await fetch(search, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!geocode.ok) throw new Error(`Géocodage diagnostic indisponible (${geocode.status}).`);
  const json = await geocode.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
  const coordinates = json.features?.[0]?.geometry?.coordinates;
  if (!coordinates) throw new Error("Adresse introuvable pour la sortie diagnostique DP2.");
  const [longitude, latitude] = coordinates;
  const { x, y } = toWebMercator(longitude, latitude);
  const widthMeters = 110;
  const heightMeters = 78.6;
  const url = new URL(IGN_WMS_ENDPOINT);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: "HR.ORTHOIMAGERY.ORTHOPHOTOS,CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
    STYLES: "normal,normal",
    CRS: "EPSG:3857",
    BBOX: [x - widthMeters / 2, y - heightMeters / 2, x + widthMeters / 2, y + heightMeters / 2].join(","),
    WIDTH: "1400",
    HEIGHT: "1000",
    FORMAT: "image/png",
    TRANSPARENT: "false",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: "image/png" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Fond IGN diagnostic indisponible (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { role: "roof", mimeType: "image/png", base64: bytes.toString("base64"), filename: "dp2-diagnostic-source.png" };
}

async function chooseSource(input: DpPieceInput): Promise<PiecePhotoInput> {
  if (input.dp === 2) return dp2Source(input.address);
  const photos = input.photos ?? [];
  const wanted = input.dp === 6
    ? ["far"]
    : input.dp === 5
      ? ["roof", "near"]
      : ["near", "roof"];
  for (const role of wanted) {
    const photo = photos.find((candidate) => candidate.role === role);
    if (photo?.base64) return photo;
  }
  const anyPhoto = photos.find((candidate) => candidate.base64);
  if (anyPhoto) return anyPhoto;
  throw new Error(`DP${input.dp} : aucune source disponible pour le diagnostic.`);
}

function blob(base64: string, mimeType: string) {
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
}

function ext(mimeType: string) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

function diagnosticPrompt(input: DpPieceInput, originalError: string) {
  const count = Number(input.panelCount ?? 0);
  const rows = Number(input.rows ?? 0);
  const columns = Number(input.columns ?? 0);
  return [
    `PILOTPAPER TEST DIAGNOSTIC FALLBACK — DP${input.dp}.`,
    "The normal validated generator failed. Produce ONE visible diagnostic candidate instead of refusing the task.",
    "This output is explicitly NON VALIDATED and will be reviewed by a human. Do not hide mistakes by refusing to render.",
    `Project address: ${input.address}.`,
    input.moduleReference ? `PV module: ${input.moduleReference}.` : "",
    count ? `Requested PV count: exactly ${count}.` : "",
    rows && columns ? `Requested matrix: ${rows} rows × ${columns} columns.` : "",
    input.orientation ? `Orientation: ${input.orientation}.` : "",
    input.placement ? `Preferred placement: ${input.placement}.` : "",
    `Normal pipeline failure: ${originalError.slice(0, 500)}.`,
    input.dp === 2 ? "Use the supplied official aerial/cadastral source. Add the requested photovoltaic array to the most plausible target roof for diagnostic inspection. Do not redraw the surroundings." : "",
    input.dp === 3 ? "Produce a DP3-style lateral architectural section plus a small axonometric roof view. Keep the visible building identity as close as possible to the source." : "",
    input.dp === 4 ? "Produce the established DP4 initial/projected comparison: same source photo on both sides, PV added only on the projected side." : "",
    input.dp === 5 ? "Produce a close exterior projected view of the same building with the requested array." : "",
    input.dp === 6 ? "Preserve the distant source photograph and add the requested array only." : "",
    "Return the image even if some uncertainty remains. The purpose is diagnosis, not certification.",
  ].filter(Boolean).join("\n");
}

async function tryRawDiagnosticImage(input: DpPieceInput, source: PiecePhotoInput, originalError: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || input.dp < 2 || input.dp > 6) return null;
  try {
    const response = await pilotPaperOpenAiRequest(
      "https://api.openai.com/v1/images/edits",
      () => {
        const form = new FormData();
        form.set("model", "gpt-image-2");
        form.set("prompt", diagnosticPrompt(input, originalError));
        form.set("quality", "high");
        form.append("image[]", blob(source.base64, source.mimeType), source.filename ?? `diagnostic-source.${ext(source.mimeType)}`);
        for (const reference of input.references ?? []) {
          if (!reference.base64) continue;
          form.append("image[]", blob(reference.base64, reference.mimeType), `reference-dp${reference.dp}.${ext(reference.mimeType)}`);
        }
        return {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(240_000),
        };
      },
      { label: `Diagnostic DP${input.dp}`, imageGeneration: true, maxAttempts: 2 },
    );
    const json = await response.json() as { data?: Array<{ b64_json?: string }> };
    return json.data?.[0]?.b64_json ?? null;
  } catch {
    return null;
  }
}

export async function generateDiagnosticFallback(input: DpPieceInput, originalError: unknown): Promise<DpPieceOutput> {
  const contract = getDpPieceContract(input.dp as DPNumber);
  if (!contract) throw originalError instanceof Error ? originalError : new Error("Génération diagnostique impossible.");
  const message = originalError instanceof Error ? originalError.message : String(originalError ?? "Échec inconnu");
  const source = await chooseSource(input);
  const generated = await tryRawDiagnosticImage(input, source, message);
  const usesGeneratedCandidate = Boolean(generated);

  return {
    dp: input.dp,
    title: contract.title,
    validationStatus: "test_unverified",
    mimeType: usesGeneratedCandidate ? "image/png" : source.mimeType,
    base64: generated ?? source.base64,
    sourceSummary: [
      `DP${input.dp} conservée en MODE DIAGNOSTIC NON VALIDÉ`,
      usesGeneratedCandidate
        ? "Le générateur normal a échoué ; un candidat brut a été produit sans masquer l'erreur."
        : "Le moteur visuel n'a pas pu produire de candidat ; la source réelle est conservée à la place pour que le dossier et le diagnostic restent visibles.",
      `Erreur du chemin normal : ${message}`,
      "Cette sortie peut être erronée et ne doit pas être déposée en mairie sans correction.",
    ],
    inspector: {
      passed: false,
      score: 0,
      checks: ["Mode diagnostic : sortie volontairement conservée malgré l'échec du chemin validé."],
      issues: [message],
    },
  };
}

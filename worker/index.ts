/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DP_ANALYSIS_MODEL?: string;
  DP_JUDGE_MODEL?: string;
  DP_IMAGE_MODEL?: string;
  DP_IMAGE_PROVIDER?: string;
  DP_MAX_RETRIES?: string;
  DP_QA_PASS_SCORE?: string;
  DP_REALISM_PASS_SCORE?: string;
  DP_TEST_EXPORT?: string;
  DP_TEST_FAST?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function syncRuntimeVars(env: Env) {
  const vars = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    DP_ANALYSIS_MODEL: env.DP_ANALYSIS_MODEL,
    DP_JUDGE_MODEL: env.DP_JUDGE_MODEL,
    DP_IMAGE_MODEL: env.DP_IMAGE_MODEL,
    DP_IMAGE_PROVIDER: env.DP_IMAGE_PROVIDER,
    DP_MAX_RETRIES: env.DP_MAX_RETRIES,
    DP_QA_PASS_SCORE: env.DP_QA_PASS_SCORE,
    DP_REALISM_PASS_SCORE: env.DP_REALISM_PASS_SCORE,
    DP_TEST_EXPORT: env.DP_TEST_EXPORT,
    DP_TEST_FAST: env.DP_TEST_FAST,
  };
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "string" && value.length > 0) process.env[key] = value;
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    syncRuntimeVars(env);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

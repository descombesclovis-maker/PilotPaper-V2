export interface EngineConfig {
  openaiApiKey?: string;
  geminiApiKey?: string;
  analysisModel: string;
  judgeModel: string;
  imageModel: string;
  imageProvider: "openai" | "gemini";
  maxRetries: number;
  qaPassScore: number;
  realismPassScore: number;
  /** Explicit host-level test mode. Do not rely on process.env inside workers. */
  testFast?: boolean;
}

function envFlag(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function configFromEnv(env = process.env): EngineConfig {
  return {
    openaiApiKey: env.OPENAI_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    analysisModel: env.DP_ANALYSIS_MODEL ?? "gpt-5.6-sol",
    judgeModel: env.DP_JUDGE_MODEL ?? "gpt-5.6-sol",
    imageModel: env.DP_IMAGE_MODEL ?? "gpt-image-2",
    imageProvider: env.DP_IMAGE_PROVIDER === "gemini" ? "gemini" : "openai",
    // Visual quality is prioritized in the production-validation phase. This means up to 6 attempts total.
    maxRetries: Number(env.DP_MAX_RETRIES ?? 5),
    qaPassScore: Number(env.DP_QA_PASS_SCORE ?? 0.96),
    realismPassScore: Number(env.DP_REALISM_PASS_SCORE ?? 0.97),
    testFast: envFlag(env.DP_TEST_FAST),
  };
}

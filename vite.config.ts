import vinext from "vinext";
import { defineConfig } from "vite";

const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

function localRuntimeVars() {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
    DP_ANALYSIS_MODEL: process.env.DP_ANALYSIS_MODEL ?? "gpt-5.6-sol",
    DP_JUDGE_MODEL: process.env.DP_JUDGE_MODEL ?? "gpt-5.6-sol",
    DP_IMAGE_MODEL: process.env.DP_IMAGE_MODEL ?? "gpt-image-2",
    DP_IMAGE_PROVIDER: process.env.DP_IMAGE_PROVIDER ?? "openai",
    DP_MAX_RETRIES: process.env.DP_MAX_RETRIES ?? "5",
    DP_QA_PASS_SCORE: process.env.DP_QA_PASS_SCORE ?? "0.96",
    DP_REALISM_PASS_SCORE: process.env.DP_REALISM_PASS_SCORE ?? "0.97",
    DP_TEST_EXPORT: process.env.DP_TEST_EXPORT ?? "true",
    DP_TEST_FAST: process.env.DP_TEST_FAST ?? "false",
  };
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: localRuntimeVars(),
  d1_databases: [
    {
      binding: "DB",
      database_name: "pilotpaper-local",
      database_id: LOCAL_DATABASE_ID,
    },
  ],
  r2_buckets: [
    {
      binding: "BUCKET",
      bucket_name: "pilotpaper-local",
    },
  ],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});

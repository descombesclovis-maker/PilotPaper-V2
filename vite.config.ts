import vinext from "vinext";
import { defineConfig } from "vite";

const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const workerEnvironmentKeys = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "DP_ANALYSIS_MODEL",
  "DP_JUDGE_MODEL",
  "DP_IMAGE_MODEL",
  "DP_IMAGE_PROVIDER",
  "DP_MAX_RETRIES",
  "DP_QA_PASS_SCORE",
  "DP_REALISM_PASS_SCORE",
  "DP_TEST_EXPORT",
  "DP_TEST_FAST",
  "PILOTPAPER_DEV_EMAIL",
  "PILOTPAPER_DEV_NAME",
  "PILOTPAPER_ADMIN_EMAILS",
] as const;

const runtimeVars = Object.fromEntries(
  workerEnvironmentKeys.flatMap((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.length > 0
      ? ([[key, value]] as const)
      : [];
  }),
);

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: runtimeVars,
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

import { configFromEnv, type EngineConfig } from "./config";
import { OpenAIVisionAnalyzer } from "./providers/openaiVision";
import { OpenAIImageEditor } from "./providers/openaiImage";
import { GeminiImageEditor } from "./providers/geminiImage";
import { OpenAIQualityJudge } from "./providers/openaiJudge";
import { OpenAICrossPieceJudge } from "./providers/openaiCrossPieceJudge";
import { AIVisualGenerator } from "./generators/aiVisualGenerator";
import { DPAIEngine } from "./orchestrator";
import { OpenAIEnvironmentPhotoJudge } from "./providers/openaiEnvironmentPhotoJudge";

export function createDPAIEngine(config: EngineConfig = configFromEnv()): DPAIEngine {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required for analysis and QA");
  const analyzer = new OpenAIVisionAnalyzer(config.openaiApiKey, config.analysisModel);
  const judge = new OpenAIQualityJudge(config.openaiApiKey, config.judgeModel, config.qaPassScore, config.realismPassScore);
  const crossJudge = new OpenAICrossPieceJudge(config.openaiApiKey, config.judgeModel, Math.max(config.qaPassScore, .97));
  const editor = config.imageProvider === "gemini"
    ? (() => { if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is required when DP_IMAGE_PROVIDER=gemini"); return new GeminiImageEditor(config.geminiApiKey); })()
    : new OpenAIImageEditor(config.openaiApiKey, config.imageModel);
  const environmentJudge = new OpenAIEnvironmentPhotoJudge(config.openaiApiKey, config.judgeModel, .92);
  return new DPAIEngine(analyzer, new AIVisualGenerator(editor, judge, config.maxRetries), crossJudge, 2, environmentJudge);
}

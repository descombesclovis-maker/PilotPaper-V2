import { getDPAIHealth } from "@/lib/dp-ai-gate";

export async function GET() {
  const health = getDPAIHealth();
  return Response.json(health, {
    status: health.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

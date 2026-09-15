import { OFFICIAL_CERFA_FILE } from "@/lib/official-cerfa";
import { applyProductionDocumentBranding, type ProductionDocumentBranding } from "@/lib/dp-production-branding";
import { POST as generateBaseDossier } from "../generate/route";

export const dynamic = "force-dynamic";

type BrandedGenerationBody = {
  branding?: ProductionDocumentBranding;
};

function sanitizeBranding(input: ProductionDocumentBranding | undefined): ProductionDocumentBranding {
  if (!input) return {};
  const color = (value: unknown) => /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : undefined;
  return {
    companyName: String(input.companyName ?? "").slice(0, 80),
    logoDataUrl: typeof input.logoDataUrl === "string" && input.logoDataUrl.length <= 800_000 ? input.logoDataUrl : undefined,
    primaryColor: color(input.primaryColor),
    accentColor: color(input.accentColor),
    paperColor: color(input.paperColor),
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({})) as BrandedGenerationBody;
  const branding = sanitizeBranding(body.branding);

  // Keep the production generation engine untouched. Branding is a final document layer.
  const baseUrl = request.url.replace(/\/generate-branded(?:\?.*)?$/, "/generate");
  const baseRequest = new Request(baseUrl, {
    method: "POST",
    headers: request.headers,
  });
  const generatedResponse = await generateBaseDossier(baseRequest, context);
  if (!generatedResponse.ok) return generatedResponse;

  const contentType = generatedResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("application/pdf")) return generatedResponse;

  const generatedBytes = new Uint8Array(await generatedResponse.arrayBuffer());
  const cerfaResponse = await fetch(new URL(OFFICIAL_CERFA_FILE, request.url), { cache: "no-store" });
  if (!cerfaResponse.ok) {
    return Response.json({ error: "Le Cerfa officiel embarqué est indisponible pour la personnalisation du dossier." }, { status: 503 });
  }
  const officialCerfaBytes = new Uint8Array(await cerfaResponse.arrayBuffer());
  const brandedBytes = await applyProductionDocumentBranding(generatedBytes, officialCerfaBytes, branding);

  const headers = new Headers(generatedResponse.headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Length", String(brandedBytes.byteLength));
  headers.set("Cache-Control", "no-store");
  headers.set("X-PilotPaper-Branding", "agency-theme");

  return new Response(brandedBytes, { status: 200, headers });
}

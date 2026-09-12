import { env } from "cloudflare:workers";
import { ensureProjectSchema } from "@/lib/ensure-project-schema";
import { getRequestUser } from "@/lib/request-user";
import { toWebMercator } from "@/lib/dp-ai-engine/context/officialParcel";
import { fetchGoogleSolarBuildingInsights } from "@/lib/dp-ai-engine/providers/googleSolar";
import { listGoogleSolarFaces } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";

type ProjectRow = {
  id: string;
  siteAddress: string;
  formData: string;
};

function parseRecord(value: string) {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(request.headers);
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  await ensureProjectSchema();

  const { id } = await context.params;
  const project = await env.DB.prepare(
    "SELECT id, site_address AS siteAddress, form_data AS formData FROM projects WHERE id=? AND owner_email=? LIMIT 1",
  ).bind(id, user.email).first<ProjectRow>();
  if (!project) return Response.json({ error: "Dossier introuvable." }, { status: 404 });

  const details = parseRecord(project.formData);
  const longitude = number(details.siteLongitude);
  const latitude = number(details.siteLatitude);
  const metersPerPixel = number(details.satelliteMassMetersPerPixel);
  const imageUrl = String(details.satelliteMassSourceUrl ?? "").trim();
  const imageWidthPx = 1400;
  const imageHeightPx = 1000;

  if (longitude == null || latitude == null || !(metersPerPixel && metersPerPixel > 0) || !imageUrl) {
    return Response.json({
      error: "La vue IGN rapprochée doit être générée depuis l'étape Site avant la sélection des pans.",
    }, { status: 422 });
  }

  let insights;
  try {
    insights = await fetchGoogleSolarBuildingInsights({ latitude, longitude });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Google Solar n'a pas pu identifier les pans de toiture.",
    }, { status: 502 });
  }

  const imageCenter = toWebMercator(longitude, latitude);
  const groundWidthMeters = metersPerPixel * imageWidthPx;
  const groundHeightMeters = metersPerPixel * imageHeightPx;
  const faces = listGoogleSolarFaces(insights).map((face) => {
    const center = toWebMercator(face.segment.center.longitude, face.segment.center.latitude);
    const x = 0.5 + (center.x - imageCenter.x) / groundWidthMeters;
    const y = 0.5 - (center.y - imageCenter.y) / groundHeightMeters;
    return {
      id: face.faceId,
      label: `Pan ${face.faceId}`,
      originalSegmentIndex: face.originalSegmentIndex,
      centerNormalized: { x: clamp01(x), y: clamp01(y) },
      areaMeters2: face.areaMeters2,
      panelCellCount: face.panelCount,
      pitchDegrees: face.segment.pitchDegrees,
      azimuthDegrees: face.segment.azimuthDegrees,
    };
  });

  return Response.json({
    address: project.siteAddress,
    imageUrl,
    imageWidthPx,
    imageHeightPx,
    imageryQuality: insights.imageryQuality ?? "UNKNOWN",
    faces,
  });
}

import { fetchIgnRaster, orthophotoCandidates } from "@/lib/dp-ai-engine/context/ignRaster";
import { resolveOfficialParcelContext, toWebMercator, type MetricFrame } from "@/lib/dp-ai-engine/context/officialParcel";
import { fetchGoogleSolarBuildingInsights, googleSolarConfigured, type GoogleSolarBuildingInsights } from "@/lib/dp-ai-engine/providers/googleSolar";
import { listGoogleSolarFaces } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";

export const dynamic = "force-dynamic";

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 840;
const IMAGE_ASPECT = IMAGE_HEIGHT / IMAGE_WIDTH;

function frameAroundBuilding(solar: GoogleSolarBuildingInsights): MetricFrame {
  const center = toWebMercator(solar.center.longitude, solar.center.latitude);
  let buildingWidth = 18;
  let buildingHeight = 12;

  if (solar.boundingBox) {
    const sw = toWebMercator(solar.boundingBox.sw.longitude, solar.boundingBox.sw.latitude);
    const ne = toWebMercator(solar.boundingBox.ne.longitude, solar.boundingBox.ne.latitude);
    buildingWidth = Math.max(4, Math.abs(ne.x - sw.x));
    buildingHeight = Math.max(4, Math.abs(ne.y - sw.y));
  }

  const widthMeters = Math.min(82, Math.max(36, buildingWidth * 2.8, (buildingHeight * 2.8) / IMAGE_ASPECT));
  const heightMeters = widthMeters * IMAGE_ASPECT;
  return {
    longitude: solar.center.longitude,
    latitude: solar.center.latitude,
    widthMeters,
    heightMeters,
    minX: center.x - widthMeters / 2,
    maxX: center.x + widthMeters / 2,
    minY: center.y - heightMeters / 2,
    maxY: center.y + heightMeters / 2,
  };
}

function normalizedInFrame(longitude: number, latitude: number, frame: MetricFrame) {
  const point = toWebMercator(longitude, latitude);
  return {
    x: (point.x - frame.minX) / (frame.maxX - frame.minX),
    y: (frame.maxY - point.y) / (frame.maxY - frame.minY),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { address?: unknown };
    const address = String(body.address ?? "").trim();
    if (address.length < 8) {
      return Response.json({ error: "Renseignez d'abord l'adresse exacte du projet pour afficher les pans de toiture." }, { status: 400 });
    }
    if (!googleSolarConfigured()) {
      return Response.json({ error: "La Google Solar API n'est pas configurée sur ce poste. La sélection visuelle des pans est indisponible." }, { status: 503 });
    }

    const official = await resolveOfficialParcelContext(address);
    const solar = await fetchGoogleSolarBuildingInsights({ latitude: official.latitude, longitude: official.longitude });
    const frame = frameAroundBuilding(solar);
    const raster = await fetchIgnRaster(
      orthophotoCandidates({ frame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, format: "image/png" }),
      { purpose: "Sélecteur visuel des pans : orthophoto IGN rapprochée", minBytes: 2_000, required: true },
    );
    if (!raster) throw new Error("La vue aérienne IGN rapprochée n'a pas pu être chargée.");

    const faces = listGoogleSolarFaces(solar).map((face) => ({
      id: face.faceId,
      label: `Pan ${face.faceId}`,
      originalSegmentIndex: face.originalSegmentIndex,
      centerNormalized: normalizedInFrame(face.segment.center.longitude, face.segment.center.latitude, frame),
      areaMeters2: face.areaMeters2,
      panelCellCount: face.panelCount,
      pitchDegrees: Number(face.segment.pitchDegrees),
      azimuthDegrees: Number(face.segment.azimuthDegrees),
    }));

    return Response.json({
      imageDataUrl: `data:${raster.mimeType};base64,${raster.base64}`,
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
      imageryQuality: solar.imageryQuality ?? "UNKNOWN",
      normalizedAddress: official.normalizedAddress,
      parcelReference: official.parcelReference,
      faces,
    }, { headers: { "Cache-Control": "no-store", "X-PilotPaper-Mode": "test_unverified" } });
  } catch (error) {
    console.error("[dp-piece/roof-faces] roof selector failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "La détection des pans de toiture a échoué.",
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

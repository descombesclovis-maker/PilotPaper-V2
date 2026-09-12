import { fetchIgnRaster, orthophotoCandidates } from "@/lib/dp-ai-engine/context/ignRaster";
import { fromWebMercator, toWebMercator, type MetricFrame } from "@/lib/dp-ai-engine/context/officialParcel";
import { buildArchitecturalSectionGeometry } from "@/lib/dp-ai-engine/geometry/architecturalSection";
import { googleSolarConfigured } from "@/lib/dp-ai-engine/providers/googleSolar";
import { automaticRoofDesignFromGoogleSolar } from "@/lib/dp-ai-engine/site-model/googleSolarAutomaticRoof";
import { listGoogleSolarFaces, selectGoogleSolarFace } from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";
import {
  buildingForGoogleSolarFace,
  resolveTargetRoofContext,
  type TargetRoofContext,
} from "@/lib/dp-ai-engine/site-model/targetRoofContext";
import { requireVerifiedPvModule } from "@/lib/pv-module-catalog";

export const dynamic = "force-dynamic";

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 840;
const IMAGE_ASPECT = IMAGE_HEIGHT / IMAGE_WIDTH;

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function frameAroundTarget(target: Pick<TargetRoofContext, "building" | "buildings">): MetricFrame {
  const points = target.buildings.flatMap((building) => (
    building.polygon.map(([longitude, latitude]) => toWebMercator(longitude, latitude))
  ));
  if (!points.length) {
    const [longitude, latitude] = target.building.centroid;
    const center = toWebMercator(longitude, latitude);
    const widthMeters = 40;
    const heightMeters = widthMeters * IMAGE_ASPECT;
    return {
      longitude,
      latitude,
      widthMeters,
      heightMeters,
      minX: center.x - widthMeters / 2,
      maxX: center.x + widthMeters / 2,
      minY: center.y - heightMeters / 2,
      maxY: center.y + heightMeters / 2,
    };
  }

  const minBuildingX = Math.min(...points.map((point) => point.x));
  const maxBuildingX = Math.max(...points.map((point) => point.x));
  const minBuildingY = Math.min(...points.map((point) => point.y));
  const maxBuildingY = Math.max(...points.map((point) => point.y));
  const buildingWidth = Math.max(4, maxBuildingX - minBuildingX);
  const buildingHeight = Math.max(4, maxBuildingY - minBuildingY);
  const widthMeters = Math.min(80, Math.max(30, buildingWidth * 2.2, (buildingHeight * 2.2) / IMAGE_ASPECT));
  const heightMeters = widthMeters * IMAGE_ASPECT;
  const centerX = (minBuildingX + maxBuildingX) / 2;
  const centerY = (minBuildingY + maxBuildingY) / 2;
  const center = fromWebMercator(centerX, centerY);
  return {
    longitude: center.longitude,
    latitude: center.latitude,
    widthMeters,
    heightMeters,
    minX: centerX - widthMeters / 2,
    maxX: centerX + widthMeters / 2,
    minY: centerY - heightMeters / 2,
    maxY: centerY + heightMeters / 2,
  };
}

function averageNormalized(points: Array<{ x: number; y: number }>) {
  const count = Math.max(1, points.length);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const address = String(body.address ?? "").trim();
    if (address.length < 8) {
      return Response.json({ error: "Renseignez d'abord l'adresse exacte du projet." }, { status: 400 });
    }
    if (!googleSolarConfigured()) {
      return Response.json({ error: "La Google Solar API n'est pas configurée sur ce poste." }, { status: 503 });
    }

    const moduleSpec = requireVerifiedPvModule(String(body.moduleReference ?? ""));
    const panelCount = positiveInteger(body.panelCount, "Le nombre de panneaux");
    const rows = positiveInteger(body.rows, "Le nombre de rangées");
    const columns = positiveInteger(body.columns, "Le nombre de colonnes");
    if (rows * columns !== panelCount) {
      return Response.json({ error: `La configuration ${rows} × ${columns} ne correspond pas aux ${panelCount} panneaux demandés.` }, { status: 400 });
    }
    const orientation = body.orientation === "landscape" ? "landscape" : "portrait";
    const placement = ["centered", "left", "right", "custom"].includes(String(body.placement))
      ? String(body.placement) as "centered" | "left" | "right" | "custom"
      : "centered";
    const interPanelGapMeters = Math.max(0, finiteNumber(body.interPanelGapMm, 20)) / 1000;

    const target = await resolveTargetRoofContext(address);
    const frame = frameAroundTarget(target);
    const raster = await fetchIgnRaster(
      orthophotoCandidates({ frame, widthPx: IMAGE_WIDTH, heightPx: IMAGE_HEIGHT, format: "image/png" }),
      { purpose: "Sélecteur des pans compatibles du bâtiment cible", minBytes: 2_000, required: true },
    );
    if (!raster) throw new Error("La vue aérienne IGN rapprochée n'a pas pu être chargée.");

    const faces = [] as Array<{
      id: string;
      label: string;
      originalSegmentIndex: number;
      buildingId: string;
      centerNormalized: { x: number; y: number };
      areaMeters2: number;
      panelCellCount: number;
      pitchDegrees: number;
      azimuthDegrees: number;
    }>;

    for (const face of listGoogleSolarFaces(target.solar)) {
      const faceBuilding = buildingForGoogleSolarFace(target.solar, face.originalSegmentIndex, target);
      if (!faceBuilding) continue;
      try {
        const selected = selectGoogleSolarFace(target.solar, face.faceId);
        const automatic = automaticRoofDesignFromGoogleSolar({
          insights: selected.insights,
          frame,
          requestedRows: rows,
          requestedColumns: columns,
          requestedOrientation: orientation,
          moduleWidthMeters: moduleSpec.widthMm / 1000,
          moduleHeightMeters: moduleSpec.heightMm / 1000,
          interPanelGapMeters,
          placement,
        });

        buildArchitecturalSectionGeometry({
          building: faceBuilding,
          insights: target.solar,
          selectedSegmentIndex: face.originalSegmentIndex,
        });

        faces.push({
          id: face.faceId,
          label: `Pan ${face.faceId}`,
          originalSegmentIndex: face.originalSegmentIndex,
          buildingId: faceBuilding.id,
          centerNormalized: averageNormalized(automatic.design.quadNormalized),
          areaMeters2: face.areaMeters2,
          panelCellCount: face.panelCount,
          pitchDegrees: Number(face.segment.pitchDegrees),
          azimuthDegrees: Number(face.segment.azimuthDegrees),
        });
      } catch {
        // Not selectable for this exact PV configuration and V1 document set.
      }
    }

    if (!faces.length) {
      return Response.json({
        error: `Aucun pan du bâtiment cadastral cible ne peut accueillir automatiquement la configuration ${rows} × ${columns} avec le module ${moduleSpec.canonicalReference}.`,
      }, { status: 409 });
    }

    return Response.json({
      imageDataUrl: `data:${raster.mimeType};base64,${raster.base64}`,
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
      imageryQuality: target.solar.imageryQuality ?? "UNKNOWN",
      normalizedAddress: target.parcel.normalizedAddress,
      parcelReference: target.parcel.parcelReference,
      buildingId: target.building.id,
      buildingIds: target.buildings.map((building) => building.id),
      configuration: {
        moduleReference: moduleSpec.canonicalReference,
        panelCount,
        rows,
        columns,
        orientation,
      },
      faces,
    }, { headers: { "Cache-Control": "no-store", "X-PilotPaper-Mode": "test_unverified" } });
  } catch (error) {
    console.error("[dp-piece/roof-faces] compatible roof selector failed", error);
    return Response.json({
      error: error instanceof Error ? error.message : "La détection des pans compatibles a échoué.",
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

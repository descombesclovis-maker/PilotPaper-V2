import { fetchIgnRaster, orthophotoCandidates } from "@/lib/dp-ai-engine/context/ignRaster";
import { fromWebMercator, toWebMercator, type MetricFrame } from "@/lib/dp-ai-engine/context/officialParcel";
import { googleSolarConfigured } from "@/lib/dp-ai-engine/providers/googleSolar";
import { automaticRoofDesignFromGoogleSolar } from "@/lib/dp-ai-engine/site-model/googleSolarAutomaticRoof";
import {
  listGoogleSolarFaces,
  selectGoogleSolarFaceBySegmentIndex,
} from "@/lib/dp-ai-engine/site-model/googleSolarFaceSelection";
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
  const widthMeters = Math.min(72, Math.max(28, buildingWidth * 1.8, (buildingHeight * 1.8) / IMAGE_ASPECT));
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

function normalizedGeoPoint(
  point: { latitude: number; longitude: number },
  frame: MetricFrame,
) {
  const projected = toWebMercator(point.longitude, point.latitude);
  return {
    x: Math.max(0, Math.min(1, (projected.x - frame.minX) / (frame.maxX - frame.minX))),
    y: Math.max(0, Math.min(1, (frame.maxY - projected.y) / (frame.maxY - frame.minY))),
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
      { purpose: "Sélecteur des pans compatibles du bâtiment adressé", minBytes: 2_000, required: true },
    );
    if (!raster) throw new Error("La vue aérienne IGN rapprochée n'a pas pu être chargée.");

    const compatible = [] as Array<{
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
        const selected = selectGoogleSolarFaceBySegmentIndex(target.solar, face.originalSegmentIndex);
        automaticRoofDesignFromGoogleSolar({
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

        compatible.push({
          originalSegmentIndex: face.originalSegmentIndex,
          buildingId: faceBuilding.id,
          centerNormalized: normalizedGeoPoint(face.segment.center, frame),
          areaMeters2: face.areaMeters2,
          panelCellCount: face.panelCount,
          pitchDegrees: Number(face.segment.pitchDegrees),
          azimuthDegrees: Number(face.segment.azimuthDegrees),
        });
      } catch {
        // This physical pan exists on the addressed house but cannot host this
        // exact module/configuration. DP3 is deliberately NOT a selector gate.
      }
    }

    const faces = compatible
      .sort((a, b) => b.areaMeters2 - a.areaMeters2 || a.originalSegmentIndex - b.originalSegmentIndex)
      .map((face, index) => {
        const id = String.fromCharCode(65 + index);
        return {
          ...face,
          id,
          label: `Pan ${id}`,
          stableKey: `${face.buildingId}:${face.originalSegmentIndex}`,
        };
      });

    if (!faces.length) {
      return Response.json({
        error: `Aucun pan de la maison correspondant à l'adresse ne peut accueillir automatiquement la configuration ${rows} × ${columns} avec le module ${moduleSpec.canonicalReference}.`,
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

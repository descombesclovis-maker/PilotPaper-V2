import type { VisionAnalyzer } from "./interfaces";
import type {
  InputPhoto,
  ProjectContext,
  ProjectForm,
  RoofFaceObservation,
  RoofViewObservation,
} from "../types";
import { resolveProjectLayout } from "../geometry/projectLayout";

function fallbackQuad(index: number, total: number) {
  const count = Math.max(1, total);
  const slotWidth = 0.84 / count;
  const left = 0.08 + index * slotWidth + 0.015;
  const right = 0.08 + (index + 1) * slotWidth - 0.015;
  return [
    { x: left, y: 0.80 },
    { x: right, y: 0.80 },
    { x: right - Math.min(0.05, slotWidth * 0.12), y: 0.26 },
    { x: left + Math.min(0.05, slotWidth * 0.12), y: 0.26 },
  ];
}

function fallbackView(
  role: InputPhoto["role"],
  faceId: string,
  index: number,
  total: number,
): RoofViewObservation {
  const quad = fallbackQuad(index, total);
  return {
    role,
    faceId,
    selectedFaceVisible: true,
    confidence: 0.05,
    roofPolygonNormalized: quad,
    gutterLineNormalized: [quad[0]!, quad[1]!],
    ridgeLineNormalized: [quad[3]!, quad[2]!],
    perspectiveNotes: ["TEST FALLBACK: quadrilatère approximatif utilisé uniquement pour obtenir un rendu OpenAI non validé."],
  };
}

/**
 * Test-only safety wrapper.
 *
 * The strict OpenAI vision analysis remains the first choice. If it rejects the
 * evidence geometry, local test mode still gets a deterministic, deliberately
 * approximate roof quad so GPT Image can be called and a visible result can be
 * exported. Production never uses this wrapper.
 */
export class TestFallbackVisionAnalyzer implements VisionAnalyzer {
  constructor(private delegate: VisionAnalyzer) {}

  async analyze(form: ProjectForm, photos: InputPhoto[]): Promise<ProjectContext> {
    try {
      return await this.delegate.analyze(form, photos);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Erreur d'analyse inconnue";
      console.error(`[PilotPaper][TEST][vision-fallback] ${reason}`);

      const layout = resolveProjectLayout(form);
      const roles = [...new Set(photos.map((photo) => photo.role))];
      const totalFaces = Math.max(1, layout.placements.length);

      const faces: RoofFaceObservation[] = layout.placements.map((placement, index) => ({
        id: placement.faceId,
        label: placement.label ?? `Pan ${placement.faceId}`,
        confidence: 0.05,
        slopeDeg: form.roofGeometry?.slopeDeg,
        views: roles.map((role) => fallbackView(role, placement.faceId, index, totalFaces)),
        obstacles: [],
      }));

      const flattenedViews = faces.flatMap((face) => face.views);
      const primaryPlacement = layout.placements[0]!;
      const primaryFace = faces[0]!;
      const preferredRole = photos.find((photo) => photo.role === "near")?.role
        ?? photos.find((photo) => photo.role === "roof")?.role
        ?? photos[0]?.role
        ?? "near";
      const primaryView = primaryFace.views.find((view) => view.role === preferredRole) ?? primaryFace.views[0]!;
      const primaryMetric = form.roofFaces?.find((face) => face.id === primaryPlacement.faceId);

      return {
        projectId: form.projectId,
        address: form.address,
        array: form.array,
        panel: form.panel,
        exactPanelCount: layout.count,
        fieldWidthMm: layout.primaryFieldWidthMm,
        fieldHeightMm: layout.primaryFieldHeightMm,
        roofGeometry: primaryMetric ?? {
          widthMm: primaryPlacement.widthMm,
          slopeLengthMm: primaryPlacement.slopeLengthMm,
          slopeDeg: form.roofGeometry?.slopeDeg ?? 0,
          source: "external-data",
        },
        facePlacements: layout.placements,
        support: form.support,
        roof: {
          selectedFaceDescription: `${primaryFace.label} — TEST APPROXIMATIF`,
          confidence: 0.05,
          roofPolygonNormalized: primaryView.roofPolygonNormalized,
          gutterLineNormalized: primaryView.gutterLineNormalized,
          ridgeLineNormalized: primaryView.ridgeLineNormalized,
          views: flattenedViews,
          faces,
          obstacles: [],
          perspectiveNotes: ["Géométrie de secours utilisée après rejet de l'analyse stricte."],
          uncertainties: [reason],
        },
        immutableFacts: [
          "TEST_UNVERIFIED_VISION_FALLBACK",
          `Analyse stricte rejetée : ${reason}`,
        ],
      };
    }
  }
}

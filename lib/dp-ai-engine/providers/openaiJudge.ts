import type { QualityJudge } from "./interfaces";
import type { QualityReport } from "../types";
import { judgePrompt } from "../prompts/judge";
import { toDataUrl } from "../utils/dataUrl";
import { openaiJson } from "./openaiJson";
import { cropPngAroundPolygons } from "../utils/pngPixels";
import {
  allPanelPolygonsForRole,
  allPanelPolygonsForRoleProjective,
} from "../geometry/panelProjection";

export type QualityProjectionMode = "legacy-bilinear" | "projective";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    score: { type: "number", minimum: 0, maximum: 1 },
    panelCountObserved: { type: ["integer", "null"] },
    rowsObserved: { type: ["integer", "null"] },
    columnsObserved: { type: ["integer", "null"] },
    buildingPreserved: { type: "boolean" },
    perspectiveCoherent: { type: "boolean" },
    scaleCoherent: { type: "boolean" },
    placementCoherent: { type: "boolean" },
    roofFaceCorrect: { type: "boolean" },
    insideSelectedRoofFace: { type: "boolean" },
    singleRoofPlane: { type: "boolean" },
    crossesRidge: { type: "boolean" },
    arrayGeometryConsistent: { type: "boolean" },
    photorealismScore: { type: ["number", "null"], minimum: 0, maximum: 1 },
    materialRealistic: { type: ["boolean", "null"] },
    lightingMatched: { type: ["boolean", "null"] },
    reflectionsNatural: { type: ["boolean", "null"] },
    contactShadowsNatural: { type: ["boolean", "null"] },
    edgeIntegrationNatural: { type: ["boolean", "null"] },
    localSharpnessMatched: { type: ["boolean", "null"] },
    localNoiseCompressionMatched: { type: ["boolean", "null"] },
    cgiArtifactsAbsent: { type: ["boolean", "null"] },
    roofTexturePreserved: { type: ["boolean", "null"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["warning", "error", "fatal"] },
          message: { type: "string" },
          correction: { type: "string" },
        },
        required: ["code", "severity", "message", "correction"],
      },
    },
    correctionPrompt: { type: "string" },
  },
  required: [
    "passed",
    "score",
    "panelCountObserved",
    "rowsObserved",
    "columnsObserved",
    "buildingPreserved",
    "perspectiveCoherent",
    "scaleCoherent",
    "placementCoherent",
    "roofFaceCorrect",
    "insideSelectedRoofFace",
    "singleRoofPlane",
    "crossesRidge",
    "arrayGeometryConsistent",
    "photorealismScore",
    "materialRealistic",
    "lightingMatched",
    "reflectionsNatural",
    "contactShadowsNatural",
    "edgeIntegrationNatural",
    "localSharpnessMatched",
    "localNoiseCompressionMatched",
    "cgiArtifactsAbsent",
    "roofTexturePreserved",
    "issues",
    "correctionPrompt",
  ],
} as const;

export class OpenAIQualityJudge implements QualityJudge {
  constructor(
    private apiKey: string,
    private model = "gpt-5.6-sol",
    private passScore = 0.96,
    private realismPassScore = 0.97,
    private projectionMode: QualityProjectionMode = "legacy-bilinear",
  ) {}

  async judge({
    dp,
    form,
    context,
    originalPhotos,
    generated,
  }: Parameters<QualityJudge["judge"]>[0]): Promise<QualityReport> {
    if (!generated.base64) throw new Error("QA requires an image asset");

    const candidate = `data:${generated.mimeType};base64,${generated.base64}`;
    const imageDataUrls = [...originalPhotos.map(toDataUrl), candidate];
    let prompt = judgePrompt(dp, form, context);

    // Full-frame inspection can hide seams. For DP6 append source/candidate
    // crops around the exact deterministic array. Production keeps the legacy
    // mapping by default; the isolated Admin lab opts into projective geometry.
    if (dp === 6 && generated.sourceRole) {
      const base = originalPhotos.find((photo) => photo.role === generated.sourceRole);
      const polygons =
        this.projectionMode === "projective"
          ? allPanelPolygonsForRoleProjective(context, generated.sourceRole) ?? []
          : allPanelPolygonsForRole(context, generated.sourceRole) ?? [];

      if (base?.mimeType === "image/png" && polygons.length) {
        try {
          const originalCrop = cropPngAroundPolygons(base.base64, polygons, 0.05);
          const candidateCrop = cropPngAroundPolygons(generated.base64, polygons, 0.05);
          imageDataUrls.push(
            `data:image/png;base64,${originalCrop}`,
            `data:image/png;base64,${candidateCrop}`,
          );
          prompt +=
            "\n\nADDITIONAL ZOOM EVIDENCE: the final two images are (1) original roof crop before installation and (2) candidate crop after insertion. Compare them at edge/pixel-texture level. Any obvious seam, halo, floating edge, mismatch of sharpness/noise/compression, fake reflection or CGI texture is grounds for rejection.";
        } catch {
          // Full-frame QA still runs if crop generation cannot be completed.
        }
      }
    }

    const report = await openaiJson<QualityReport>({
      apiKey: this.apiKey,
      model: this.model,
      prompt,
      imageDataUrls,
      schemaName: "dp_quality_report",
      schema: schema as unknown as Record<string, unknown>,
    });

    const fatalCode = report.issues.some(
      (issue) =>
        issue.severity === "fatal" ||
        [
          "ARRAY_CROSSES_RIDGE",
          "ARRAY_CROSSES_HIP",
          "WRONG_FACE_ALLOCATION",
          "WRONG_ROOF_FACE",
          "ARRAY_OUTSIDE_ALLOCATED_FACE",
          "ARRAY_OUTSIDE_SELECTED_ROOF_FACE",
          "BUILDING_GEOMETRY_CHANGED",
          "OBSTACLE_REMOVED",
          "SUPPORT_STRUCTURE_CHANGED",
        ].includes(issue.code),
    );

    const hardMismatch =
      (report.panelCountObserved != null &&
        report.panelCountObserved !== context.exactPanelCount) ||
      ((context.facePlacements?.length ?? 0) <= 1 &&
        report.rowsObserved != null &&
        report.rowsObserved !== (context.facePlacements?.[0]?.rows ?? context.array.rows)) ||
      ((context.facePlacements?.length ?? 0) <= 1 &&
        report.columnsObserved != null &&
        report.columnsObserved !==
          (context.facePlacements?.[0]?.columns ?? context.array.columns)) ||
      !report.buildingPreserved ||
      !report.perspectiveCoherent ||
      !report.scaleCoherent ||
      !report.placementCoherent ||
      !report.roofFaceCorrect ||
      !report.insideSelectedRoofFace ||
      !report.singleRoofPlane ||
      report.crossesRidge ||
      !report.arrayGeometryConsistent ||
      fatalCode ||
      (dp === 6 &&
        ((report.photorealismScore ?? 0) < this.realismPassScore ||
          report.materialRealistic !== true ||
          report.lightingMatched !== true ||
          report.reflectionsNatural !== true ||
          report.contactShadowsNatural !== true ||
          report.edgeIntegrationNatural !== true ||
          report.localSharpnessMatched !== true ||
          report.localNoiseCompressionMatched !== true ||
          report.cgiArtifactsAbsent !== true ||
          report.roofTexturePreserved !== true));

    report.passed = Boolean(report.passed && report.score >= this.passScore && !hardMismatch);
    return report;
  }
}

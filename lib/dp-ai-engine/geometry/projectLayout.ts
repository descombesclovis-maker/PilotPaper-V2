import type { FacePlacement, ProjectForm, RoofFaceMetricGeometry } from "../types";
import { allocateAcrossRoofFaces } from "./multiRoofAllocation";
import { computePVField, checkSingleRoofPlaneFit } from "./pvConstraints";

export function requestedPanelCount(form: ProjectForm): number {
  const fallback = form.array.rows * form.array.columns;
  const value = Math.trunc(form.requestedPanelCount ?? fallback);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("Requested photovoltaic module quantity must be a positive integer.");
  }
  return value;
}

function edgeMinimum(value: number | undefined) {
  return Math.max(0, Number.isFinite(value) ? Number(value) : 0);
}

/**
 * Resolve one physical lateral origin for the complete PV field.
 * Partial rows are positioned relative to this field origin later by the
 * projection layer, so layout and image masks cannot silently disagree.
 */
export function resolveLateralClearances(
  form: ProjectForm,
  roofWidthMm: number,
  fieldWidthMm: number,
): { fits: boolean; leftMm: number; rightMm: number; reason?: string } {
  const minimumLeft = edgeMinimum(form.array.leftEdgeClearanceMm);
  const minimumRight = edgeMinimum(form.array.rightEdgeClearanceMm);
  const availableWidth = roofWidthMm - minimumLeft - minimumRight;
  if (fieldWidthMm > availableWidth + 1e-6) {
    return {
      fits: false,
      leftMm: minimumLeft,
      rightMm: roofWidthMm - fieldWidthMm - minimumLeft,
      reason: "PV field exceeds the selected roof face after lateral edge clearances.",
    };
  }

  let leftMm: number;
  let rightMm: number;
  if (form.array.placement === "left") {
    leftMm = minimumLeft;
    rightMm = roofWidthMm - fieldWidthMm - leftMm;
  } else if (form.array.placement === "right") {
    rightMm = minimumRight;
    leftMm = roofWidthMm - fieldWidthMm - rightMm;
  } else if (form.array.placement === "custom" && form.array.leftEdgeClearanceMm != null) {
    leftMm = minimumLeft;
    rightMm = roofWidthMm - fieldWidthMm - leftMm;
  } else if (form.array.placement === "custom" && form.array.rightEdgeClearanceMm != null) {
    rightMm = minimumRight;
    leftMm = roofWidthMm - fieldWidthMm - rightMm;
  } else {
    const spare = availableWidth - fieldWidthMm;
    leftMm = minimumLeft + spare / 2;
    rightMm = minimumRight + spare / 2;
  }

  const fits = leftMm >= minimumLeft - 1e-6 && rightMm >= minimumRight - 1e-6;
  return {
    fits,
    leftMm,
    rightMm,
    reason: fits ? undefined : "PV field violates a requested lateral roof-edge clearance.",
  };
}

function fieldSize(
  form: ProjectForm,
  rows: number,
  columns: number,
): { widthMm: number; heightMm: number } {
  const gap = Math.max(0, form.array.interPanelGapMm ?? 20);
  const panelWidth = form.array.orientation === "portrait" ? form.panel.widthMm : form.panel.heightMm;
  const panelHeight = form.array.orientation === "portrait" ? form.panel.heightMm : form.panel.widthMm;
  return {
    widthMm: columns * panelWidth + Math.max(0, columns - 1) * gap,
    heightMm: rows * panelHeight + Math.max(0, rows - 1) * gap,
  };
}

export function resolveProjectLayout(form: ProjectForm): {
  count: number;
  placements: FacePlacement[];
  primaryFieldWidthMm: number;
  primaryFieldHeightMm: number;
  split: boolean;
} {
  const count = requestedPanelCount(form);
  const gap = Math.max(0, form.array.interPanelGapMm ?? 20);
  const preferredGutter = Math.max(0, form.array.gutterClearanceMm ?? 300);
  const minimumRidge = Math.max(0, form.array.ridgeClearanceMm ?? 0);
  const minimumLeft = edgeMinimum(form.array.leftEdgeClearanceMm);
  const minimumRight = edgeMinimum(form.array.rightEdgeClearanceMm);
  const faces = (form.roofFaces ?? []).filter(
    (face) => (face.widthMm ?? 0) > 0 && (face.slopeLengthMm ?? 0) > 0,
  ) as Array<RoofFaceMetricGeometry & { widthMm: number; slopeLengthMm: number }>;

  if (faces.length) {
    // Preserve a user-specified exact matrix whenever it fits safely on one
    // calibrated face. This path remains deterministic and does not reflow.
    if (form.array.layoutMode !== "automatic" && form.array.rows * form.array.columns === count) {
      const ordered =
        form.roofSelection?.mode === "priority"
          ? [...faces].sort((a, b) =>
              a.id === form.roofSelection?.priorityFaceId
                ? -1
                : b.id === form.roofSelection?.priorityFaceId
                  ? 1
                  : 0,
            )
          : faces;

      for (const face of ordered) {
        const fit = checkSingleRoofPlaneFit({ ...form, roofGeometry: face, requestedPanelCount: undefined });
        if (!fit.calibrated || !fit.fits || (face.blockedCells ?? 0) !== 0) continue;
        const field = computePVField(form.panel, form.array);
        const lateral = resolveLateralClearances(form, face.widthMm, field.fieldWidthMm);
        if (!lateral.fits) continue;

        const placement: FacePlacement = {
          faceId: face.id,
          label: face.label,
          panelCount: count,
          rows: form.array.rows,
          columns: form.array.columns,
          lastRowCount: form.array.columns,
          resolvedGutterMm: fit.gutterMm ?? preferredGutter,
          resolvedRidgeMm: fit.ridgeMm,
          resolvedLeftMm: lateral.leftMm,
          resolvedRightMm: lateral.rightMm,
          widthMm: face.widthMm,
          slopeLengthMm: face.slopeLengthMm,
        };
        return {
          count,
          placements: [placement],
          primaryFieldWidthMm: field.fieldWidthMm,
          primaryFieldHeightMm: field.fieldHeightMm,
          split: false,
        };
      }
    }

    // Edge clearances reduce horizontal capacity before the allocator chooses
    // columns. The placement still stores the full physical face width.
    const allocation = allocateAcrossRoofFaces({
      panel: form.panel,
      totalPanels: count,
      orientation: form.array.orientation,
      faces: faces.map((face) => ({
        id: face.id,
        label: face.label,
        widthMm: Math.max(0, face.widthMm - minimumLeft - minimumRight),
        slopeLengthMm: face.slopeLengthMm,
        blockedCells: face.blockedCells,
      })),
      mode: form.roofSelection?.mode ?? "automatic",
      priorityFaceId: form.roofSelection?.priorityFaceId,
      gapMm: gap,
      preferredGutterMm: preferredGutter,
      minimumRidgeMm: minimumRidge,
    });
    if (!allocation.fits) throw new Error(allocation.reasons.join(" "));

    const placements: FacePlacement[] = allocation.allocations.map((allocated) => {
      const face = faces.find((candidate) => candidate.id === allocated.faceId)!;
      const field = fieldSize(form, allocated.rows, allocated.columns);
      const lateral = resolveLateralClearances(form, face.widthMm, field.widthMm);
      if (!lateral.fits) {
        throw new Error(lateral.reason ?? `PV field does not fit laterally on roof face ${face.id}.`);
      }
      if (allocated.resolvedRidgeMm < minimumRidge - 1e-6) {
        throw new Error(`PV field violates the requested ridge clearance on roof face ${face.id}.`);
      }
      return {
        faceId: allocated.faceId,
        label: face.label,
        panelCount: allocated.panelCount,
        rows: allocated.rows,
        columns: allocated.columns,
        lastRowCount: allocated.lastRowCount,
        resolvedGutterMm: allocated.resolvedGutterMm,
        resolvedRidgeMm: allocated.resolvedRidgeMm,
        resolvedLeftMm: lateral.leftMm,
        resolvedRightMm: lateral.rightMm,
        widthMm: face.widthMm,
        slopeLengthMm: face.slopeLengthMm,
      };
    });

    const primary = placements[0]!;
    const primaryField = fieldSize(form, primary.rows, primary.columns);
    return {
      count,
      placements,
      primaryFieldWidthMm: primaryField.widthMm,
      primaryFieldHeightMm: primaryField.heightMm,
      split: placements.length > 1,
    };
  }

  // Backward-compatible uncalibrated/single-face mode.
  if (form.array.layoutMode !== "automatic" && form.array.rows * form.array.columns !== count) {
    throw new Error(
      `Fixed layout ${form.array.rows}×${form.array.columns} does not equal requested quantity ${count}.`,
    );
  }
  const fit = checkSingleRoofPlaneFit({ ...form, requestedPanelCount: undefined });
  if (fit.calibrated && !fit.fits) throw new Error(fit.reasons.join(" "));
  const field = computePVField(form.panel, form.array);

  let resolvedLeftMm = fit.leftMm;
  let resolvedRightMm = fit.rightMm;
  if (form.roofGeometry?.widthMm) {
    const lateral = resolveLateralClearances(form, form.roofGeometry.widthMm, field.fieldWidthMm);
    if (!lateral.fits) throw new Error(lateral.reason ?? "PV field does not fit laterally.");
    resolvedLeftMm = lateral.leftMm;
    resolvedRightMm = lateral.rightMm;
  }

  return {
    count,
    placements: [
      {
        faceId: form.array.roofFace || "A",
        label: form.array.roofFace || "Pan A",
        panelCount: count,
        rows: form.array.rows,
        columns: form.array.columns,
        lastRowCount: form.array.columns,
        resolvedGutterMm: fit.gutterMm ?? preferredGutter,
        resolvedRidgeMm: fit.ridgeMm,
        resolvedLeftMm,
        resolvedRightMm,
        widthMm: form.roofGeometry?.widthMm ?? field.fieldWidthMm,
        slopeLengthMm: form.roofGeometry?.slopeLengthMm ?? field.fieldHeightMm,
      },
    ],
    primaryFieldWidthMm: field.fieldWidthMm,
    primaryFieldHeightMm: field.fieldHeightMm,
    split: false,
  };
}

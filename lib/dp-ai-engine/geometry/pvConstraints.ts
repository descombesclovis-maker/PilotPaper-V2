import type { ArraySpec, PanelSpec, ProjectForm } from "../types";

export function computePVField(panel: PanelSpec, array: ArraySpec) {
  const gap = array.interPanelGapMm ?? 20;
  const panelW = array.orientation === "portrait" ? panel.widthMm : panel.heightMm;
  const panelH = array.orientation === "portrait" ? panel.heightMm : panel.widthMm;
  const widthMm = array.columns * panelW + Math.max(0, array.columns - 1) * gap;
  const heightMm = array.rows * panelH + Math.max(0, array.rows - 1) * gap;
  return {
    exactPanelCount: array.rows * array.columns,
    panelProjectedWidthMm: panelW,
    panelProjectedHeightMm: panelH,
    fieldWidthMm: widthMm,
    fieldHeightMm: heightMm,
    gapMm: gap,
    aspectRatio: panelW / panelH
  };
}

export interface RoofFitResult {
  calibrated: boolean;
  fits: boolean;
  leftMm?: number;
  rightMm?: number;
  gutterMm?: number;
  ridgeMm?: number;
  reasons: string[];
}

/**
 * Deterministic single-plane fit check. A field that does not fit the selected
 * roof face is rejected BEFORE an image model is called.
 */
export function checkSingleRoofPlaneFit(form: ProjectForm): RoofFitResult {
  const f = computePVField(form.panel, form.array);
  const width = form.roofGeometry?.widthMm;
  const slope = form.roofGeometry?.slopeLengthMm;
  if (!width || !slope) {
    return { calibrated: false, fits: true, reasons: ["Selected roof face is not metrically calibrated; exact roof-edge clearances cannot be certified yet."] };
  }

  const a = form.array;
  // 300 mm is a preference, not a rigid rule. If the requested quantity needs
  // more slope length, reduce the gutter clearance down to zero before rejecting.
  const preferredGutter = Math.max(0, a.gutterClearanceMm ?? 300);
  const ridgeMin = Math.max(0, a.ridgeClearanceMm ?? 0);
  const maxGutterThatFits = slope - f.fieldHeightMm - ridgeMin;
  const gutter = Math.min(preferredGutter, Math.max(0, maxGutterThatFits));
  let left = a.leftEdgeClearanceMm;
  let right = a.rightEdgeClearanceMm;

  if (a.placement === "centered" || (left == null && right == null)) {
    const remainder = width - f.fieldWidthMm;
    left = remainder / 2;
    right = remainder / 2;
  } else if (left != null && right == null) {
    right = width - f.fieldWidthMm - left;
  } else if (right != null && left == null) {
    left = width - f.fieldWidthMm - right;
  }

  left ??= 0;
  right ??= 0;
  const computedRidge = slope - gutter - f.fieldHeightMm;
  const reasons: string[] = [];
  if (left < 0 || right < 0) reasons.push("PV field exceeds the selected roof face laterally.");
  if (maxGutterThatFits < 0 || computedRidge < ridgeMin) reasons.push("PV field reaches or crosses the ridge / opposite roof plane even after reducing gutter clearance.");

  return {
    calibrated: true,
    fits: reasons.length === 0,
    leftMm: left,
    rightMm: right,
    gutterMm: gutter,
    ridgeMm: computedRidge,
    reasons
  };
}

export function constraintFacts(panel: PanelSpec, array: ArraySpec): string[] {
  const f = computePVField(panel, array);
  return [
    `Exactly ${f.exactPanelCount} photovoltaic modules must be visible.`,
    `The layout is exactly ${array.rows} rows by ${array.columns} columns.`,
    `Each physical module is ${panel.widthMm} mm × ${panel.heightMm} mm.`,
    `Module orientation is ${array.orientation}.`,
    `The complete field is ${f.fieldWidthMm} mm × ${f.fieldHeightMm} mm before roof-perspective projection.`,
    array.gutterClearanceMm != null ? `Bottom field clearance from gutter is ${array.gutterClearanceMm} mm.` : "Do not invent a gutter clearance.",
    array.ridgeClearanceMm != null ? `Top field clearance from ridge is at least ${array.ridgeClearanceMm} mm.` : "Do not invent a ridge clearance.",
    `Placement mode is ${array.placement} on roof face: ${array.roofFace}.`,
    "ALL modules belong to ONE contiguous selected roof plane.",
    "The PV array must NEVER cross, touch or straddle the ridge to reach the opposite roof face.",
    "Never change the building geometry to make the array fit.",
    "Never add, remove, merge, crop, bend, stretch or duplicate modules."
  ];
}

export function multiFaceConstraintFacts(form: ProjectForm, placements: Array<{faceId:string;panelCount:number;rows:number;columns:number;lastRowCount:number;resolvedGutterMm:number}>): string[] {
  const requested=Math.trunc(form.requestedPanelCount ?? form.array.rows*form.array.columns);
  const gap=form.array.interPanelGapMm??20;
  const base=[
    `Exactly ${requested} photovoltaic modules must be visible in total.`,
    `Each physical module is ${form.panel.widthMm} mm × ${form.panel.heightMm} mm.`,
    `Module orientation is ${form.array.orientation}.`,
    `Inter-module gap is ${gap} mm.`,
    `Roof-selection mode is ${form.roofSelection?.mode ?? "automatic"}${form.roofSelection?.priorityFaceId?` with priority face ${form.roofSelection.priorityFaceId}`:""}.`,
  ];
  for(const p of placements){
    base.push(`Roof face ${p.faceId}: exactly ${p.panelCount} modules, arranged as ${p.rows} row(s) and up to ${p.columns} column(s); final row contains ${p.lastRowCount}; resolved lower-edge/gutter clearance ${Math.round(p.resolvedGutterMm)} mm.`);
    base.push(`Every module allocated to face ${p.faceId} must stay entirely inside that face and must never straddle any ridge/hip/high-edge boundary.`);
  }
  base.push("Never move a module from one allocated face to another, even if the image model prefers a more aesthetic arrangement.");
  base.push("Never change building geometry, roof shape, openings, chimneys, roof windows, parapets, gutters, posts or supporting beams to make the array fit.");
  base.push("Never add, remove, merge, crop, bend, stretch or duplicate modules.");
  return base;
}

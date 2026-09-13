import type { DPNumber, ProjectContext } from "../types";

function allocationFacts(c: ProjectContext) {
  const placements = c.facePlacements ?? [];
  if (placements.length > 1) {
    return placements.map((placement) => (
      `- Roof/support ${placement.faceId}: exactly ${placement.panelCount} panels, ${placement.rows} row(s), up to ${placement.columns} columns.`
    )).join("\n");
  }
  return `- Put all ${c.exactPanelCount} panels on the one requested usable roof plane.`;
}

function projectFacts(c: ProjectContext) {
  return c.immutableFacts.map((fact) => `- ${fact}`).join("\n");
}

export function dpImagePrompt(dp: DPNumber, c: ProjectContext, correction?: string): string {
  const placements = c.facePlacements ?? [];
  const primary = placements[0];
  const requestedRows = primary?.rows ?? c.array.rows;
  const requestedColumns = primary?.columns ?? c.array.columns;
  const orientation = c.array.orientation === "portrait" ? "portrait" : "landscape";
  const correctionBlock = correction ? `\nMANDATORY CORRECTION FROM THE INSPECTOR:\n${correction}` : "";

  if (dp === 2) {
    return `Create the French planning DP2 mass plan from the supplied aerial/cadastral project image.

IMPORTANT: THIS IS THE REAL SITE. DO NOT INVENT OR MOVE GEOGRAPHY.
- Preserve the exact parcel, road, neighbouring plots, building footprint and orientation visible in the source.
- Show the project building clearly and add EXACTLY ${c.exactPanelCount} photovoltaic panels on the correct roof/support.
- Requested arrangement: ${requestedRows} x ${requestedColumns}, ${orientation}.
- Keep roof windows, chimneys and all obstacles free.
- Do not move the building or resize the parcel to make the project fit.
- Produce a clean professional French planning-plan appearance, readable from above.
- Do not invent cadastral references, dimensions or labels that are not present in the authoritative facts.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

AUTHORITATIVE PV ALLOCATION:
${allocationFacts(c)}

SUCCESS = same real property + correct building + correct PV placement + exact panel count + clear planning-document presentation.${correctionBlock}`;
  }

  if (dp === 3) {
    return `Create a clean French planning DP3 architectural section representing the SAME real building shown in the supplied project references.

THIS IS A TECHNICAL SECTION, NOT A PHOTOREALISTIC PHOTO.
- Preserve the real roof type, number of slopes, slope direction and overall building proportions.
- Represent the photovoltaic installation attached to the correct roof plane.
- Use ONLY the authoritative metric facts below for slope, roof dimensions, heights and PV geometry.
- Never invent a height, slope, setback or dimension.
- If a numeric fact is not authoritative, leave it unlabeled rather than guessing.
- Roof windows, chimneys and structural discontinuities must remain coherent with the real building.
- Produce clean architectural linework on a light background suitable for a French DP dossier.
- Do not add decorative landscaping or unrelated objects.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

AUTHORITATIVE PV ALLOCATION:
${allocationFacts(c)}

The section does NOT need to display all ${c.exactPanelCount} modules individually when the cut plane cannot physically intersect all modules. It must however represent the correct photovoltaic field, orientation and roof plane without contradicting the authoritative facts.${correctionBlock}`;
  }

  const purpose: Partial<Record<DPNumber, string>> = {
    4: "Edit the supplied real project photograph to show the photovoltaic installation on the real roof while preserving the building.",
    5: "Edit the supplied real project photograph only if an exterior-aspect representation is required; preserve the real building and show the exact photovoltaic project.",
    6: "Create a highly photorealistic insertion of the photovoltaic installation into the supplied real project photograph.",
  };

  return `${purpose[dp] ?? "Edit the supplied real project photograph to show the requested photovoltaic project."}

THIS IS AN IMAGE EDIT OF THE REAL PROJECT PHOTO, NOT A NEW HOUSE.

MANDATORY RESULT:
- Add EXACTLY ${c.exactPanelCount} photovoltaic panels.
- Requested arrangement: ${requestedRows} row(s) x ${requestedColumns} column(s) when physically possible on the selected roof plane.
- Panel orientation: ${orientation}.
- Keep the panels aligned, regular, centered/balanced according to the requested placement, and parallel to the real roof plane.
- Respect the real perspective, scale and slope of the roof.
- DO NOT cover, move, erase or modify any roof window / Velux, chimney, vent, antenna, ridge, hip, valley, gutter, parapet or other visible obstacle.
- DO NOT place a panel outside the physical roof surface.
- DO NOT cross a ridge, hip, valley or roof boundary.
- If an obstacle occupies the nominal grid, reorganize the field naturally on the SAME usable roof plane while preserving EXACTLY ${c.exactPanelCount} panels and the requested row/column intent as closely as physically possible.

PROJECT ALLOCATION:
${allocationFacts(c)}

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

IMMUTABLE SCENE RULES:
- Preserve the original house, facade, roof outline, tiles/slates/sheets, doors, windows, shutters, awnings, gutters, vegetation, pool, terrace, neighbouring buildings, sky, camera position and lens perspective.
- Do not redesign, beautify, extend, repaint or reconstruct the property.
- Only the photovoltaic installation and the tiny physically necessary mounting/contact-shadow area may change.
- The final image must look like the SAME photograph taken after installation.
- Match the original exposure, white balance, sharpness, grain/compression, lighting and shadows.
- Panels must look like real dark photovoltaic glass with thin frames, subtle reflections and plausible contact shadows; never like CGI stickers.
- Never invent extra panels to fill space and never omit panels because an obstacle exists.

SUCCESS CRITERIA:
1. Exact panel count.
2. Correct rows/columns intent.
3. No panel over any obstacle.
4. All panels remain on the real roof/support plane.
5. Building and environment remain recognisably identical to the input photograph.
6. Result is suitable for the requested French planning document.${correctionBlock}`;
}

import type { DPNumber, ProjectContext } from "../types";

export function dpImagePrompt(dp: DPNumber, c: ProjectContext, correction?: string): string {
  const purpose: Partial<Record<DPNumber, string>> = {
    4: "Edit the supplied real project photograph to show the photovoltaic installation on the real roof while preserving the building.",
    5: "Edit the supplied real project photograph only if an exterior-aspect representation is required; preserve the real building and show the exact photovoltaic project.",
    6: "Create a highly photorealistic insertion of the photovoltaic installation into the supplied real project photograph.",
  };

  const placements = c.facePlacements ?? [];
  const primary = placements[0];
  const requestedRows = primary?.rows ?? c.array.rows;
  const requestedColumns = primary?.columns ?? c.array.columns;
  const orientation = c.array.orientation === "portrait" ? "portrait" : "landscape";

  const allocation = placements.length > 1
    ? placements.map((placement) => (
      `- Roof/support ${placement.faceId}: exactly ${placement.panelCount} panels, ${placement.rows} row(s), up to ${placement.columns} columns.`
    )).join("\n")
    : `- Put all ${c.exactPanelCount} panels on the one requested usable roof plane.`;

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
${allocation}

AUTHORITATIVE PROJECT FACTS:
${c.immutableFacts.map((fact) => `- ${fact}`).join("\n")}

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
6. Result is photorealistic enough to be used as a French planning insertion document.
${correction ? `\nMANDATORY CORRECTION FROM THE INSPECTOR:\n${correction}` : ""}`;
}

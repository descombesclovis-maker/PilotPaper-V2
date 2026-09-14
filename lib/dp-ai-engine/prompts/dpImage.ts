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
- Requested arrangement: EXACTLY ${requestedRows} row(s) x ${requestedColumns} column(s), ${orientation}.
- Keep roof windows, chimneys and all obstacles free.
- Do not move the building or resize the parcel to make the project fit.
- Produce a clean professional French planning-plan appearance, readable from above.
- Do not invent cadastral references, dimensions or labels that are not present in the authoritative facts.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

AUTHORITATIVE PV ALLOCATION:
${allocationFacts(c)}

SUCCESS = same real property + correct building + correct PV placement + exact panel count + exact requested matrix + clear planning-document presentation.${correctionBlock}`;
  }

  if (dp === 3) {
    return `Create a clean French planning DP3 architectural section representing the SAME real building shown in the supplied project photograph.

THIS IS A TECHNICAL SECTION, NOT A PHOTOREALISTIC PHOTO.
- Infer the real roof plane and roof type directly from the supplied real photograph. Do not use a satellite roof-face selection to choose the plane.
- Preserve the real roof type, number of slopes, slope direction and overall building proportions.
- Represent the photovoltaic installation attached to the correct visible roof plane.
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
    4: "Edit the supplied REAL project photograph to show the photovoltaic installation on that exact roof while preserving the building.",
    5: "Edit the supplied REAL project photograph to show the exact final exterior appearance of the photovoltaic project.",
    6: "Create a highly photorealistic insertion of the photovoltaic installation into the supplied REAL project photograph.",
  };

  return `${purpose[dp] ?? "Edit the supplied real project photograph to show the requested photovoltaic project."}

THIS IS A DIRECT IMAGE EDIT OF ONE REAL PROJECT PHOTO, NOT A NEW HOUSE AND NOT A SATELLITE-DRIVEN RECONSTRUCTION.

VISUAL SOURCE OF TRUTH:
- The supplied real photograph is the authority for the roof plane, roof outline, Velux/roof windows, chimneys, vents, ridges, gutters, valleys, hips, antennas and all visible obstacles.
- Identify the usable roof plane directly from this photograph exactly as a human looking at the image would.
- DO NOT use a satellite roof-face label, Google Solar segment or aerial selection to decide where panels go in this photographic edit.
- Keep the original camera position, lens perspective and framing.

MANDATORY PV RESULT:
- Add EXACTLY ${c.exactPanelCount} photovoltaic panels. Never add or remove one.
- Produce EXACTLY ${requestedRows} row(s) x ${requestedColumns} column(s). A request such as 2 x 6 means two visible rows of six panels.
- Panel orientation: ${orientation}.
- Keep each row straight, regular and parallel to the real roof plane.
- Respect the requested placement (${c.array.placement}) while prioritizing obstacle avoidance and staying inside the physical roof.
- Respect the real perspective, scale and slope of the roof.

HARD OBSTACLE RULES:
- Every Velux / roof window, chimney, vent, antenna, ridge, hip, valley, gutter, parapet and visible obstruction is a HARD NO-PANEL ZONE.
- DO NOT cover, move, erase, shrink or relocate an obstacle.
- If roof windows occupy the middle of the roof, move complete rows above and/or below them, or shift the whole matrix, while keeping EXACTLY ${requestedRows} x ${requestedColumns} panels.
- DO NOT place a panel outside the physical roof surface.
- DO NOT cross a ridge, hip, valley or roof boundary.
- If the exact requested matrix genuinely cannot fit on the visible usable roof plane, do not fake extra roof area and do not cover an obstacle. Preserve the building faithfully; the Inspector will reject the candidate rather than accepting a fabricated geometry.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

IMMUTABLE SCENE RULES:
- Preserve the original house, facade, roof outline, tiles/slates/sheets, doors, windows, shutters, awnings, gutters, vegetation, pool, terrace, neighbouring buildings, sky, camera position and lens perspective.
- Do not redesign, beautify, extend, repaint or reconstruct the property.
- Only the photovoltaic installation and the tiny physically necessary mounting/contact-shadow area may change.
- The final image must look like THE SAME PHOTOGRAPH taken after installation.
- Match the original exposure, white balance, sharpness, grain/compression, lighting and shadows.
- Panels must look like real dark photovoltaic glass with thin frames, subtle reflections and plausible contact shadows; never like CGI stickers.

SUCCESS CRITERIA:
1. Exact panel count = ${c.exactPanelCount}.
2. Exact matrix = ${requestedRows} x ${requestedColumns}.
3. Zero panel over any Velux, chimney or other obstacle.
4. All panels remain on one real usable roof plane unless the project facts explicitly require several supports.
5. Building and environment remain recognisably identical to the input photograph.
6. Perspective and panel scale look physically installed, not pasted on.
7. Result is suitable for the requested French planning document.${correctionBlock}`;
}

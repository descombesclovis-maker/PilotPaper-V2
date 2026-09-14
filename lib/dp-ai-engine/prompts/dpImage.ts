import type { DPNumber, ProjectContext } from "../types";

function projectFacts(c: ProjectContext) {
  return c.immutableFacts.map((fact) => `- ${fact}`).join("\n");
}

function exactArrayFacts(c: ProjectContext) {
  const placements = c.facePlacements ?? [];
  const primary = placements[0];
  const rows = primary?.rows ?? c.array.rows;
  const columns = primary?.columns ?? c.array.columns;
  const orientation = c.array.orientation === "portrait" ? "portrait" : "landscape";
  return {
    rows,
    columns,
    orientation,
    text: `EXACT PV CONFIGURATION:\n- Exactly ${c.exactPanelCount} photovoltaic panels.\n- Exactly ${rows} visible row(s) x ${columns} visible column(s) whenever the piece is a roof view.\n- Orientation: ${orientation}.\n- Real module size: ${c.panel.widthMm} x ${c.panel.heightMm} mm.\n- Exact theoretical field size: ${c.fieldWidthMm} x ${c.fieldHeightMm} mm.`,
  };
}

function hardRoofRules(c: ProjectContext) {
  const a = exactArrayFacts(c);
  return `${a.text}

ROOF / OBSTACLE RULES:
- Read the real roof directly from the supplied project image.
- Every Velux / roof window, chimney, vent, antenna, ridge, hip, valley, gutter, parapet and visible obstruction is a HARD NO-PANEL ZONE.
- Never erase, move, resize or cover an existing obstacle.
- Keep every panel completely inside one physically coherent usable roof plane unless the authoritative project facts explicitly require several supports.
- Keep rows straight and parallel to the real roof plane.
- If the requested matrix does not physically fit, do not invent extra roof area and do not deform the building. Preserve the real property; the Inspector must reject the candidate instead.`;
}

export function dpImagePrompt(dp: DPNumber, c: ProjectContext, correction?: string): string {
  const correctionBlock = correction ? `\nMANDATORY CORRECTION FROM THE INSPECTOR:\n${correction}` : "";
  const array = exactArrayFacts(c);

  if (dp === 1) {
    return `Create a French planning DP1 PLAN DE SITUATION from the supplied REAL official IGN aerial/cadastral imagery.

ADMINISTRATIVE PURPOSE:
- The document must first and foremost locate the exact project terrain unambiguously inside its surroundings.
- Preserve the real geography, road network, parcel pattern, buildings and orientation from the source imagery. Never redraw, move or invent geography.
- Use the close aerial reference and the user's selected roof zone to identify the correct project house.
- Keep the broad situation view readable. Add a clear but restrained project marker on the correct property.
- Add a small close-up project inset when useful so the roof can be recognised without losing the wider location context.
- On that close-up only, represent the requested photovoltaic field from above using dark panel rectangles with a BRIGHT WHITE OUTLINE so the modules remain visible on the aerial image.
- Do not replace the situation plan with a beauty render. This is a planning map/document.
- Do not invent street names, cadastral references, dimensions or labels that are not present in authoritative evidence.

${array.text}

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

SUCCESS = the mairie can immediately identify the correct terrain and project house, while the small roof/project indication remains legible and does not alter the official geography.${correctionBlock}`;
  }

  if (dp === 2) {
    return `Create a French planning DP2 PLAN DE MASSE from the supplied REAL close IGN aerial/cadastral image.

ADMINISTRATIVE PURPOSE:
- Show the real parcel, the real building footprint, access/context and the exact photovoltaic project viewed from above.
- The user's selected roof zone is the authority for WHICH house and WHICH roof plane receives the project.
- Preserve every real parcel boundary, road, neighbouring building and building footprint. Never move, resize or invent geography.
- Add EXACTLY ${c.exactPanelCount} modules on the selected roof zone.
- Produce EXACTLY ${array.rows} row(s) x ${array.columns} column(s), ${array.orientation}.
- Render modules as dark aerial rectangles with a BRIGHT WHITE OUTLINE around every panel so the array is unmistakable from above.
- Keep roof windows, chimneys and other visible obstacles free.
- Do not invent cadastral references or numeric dimensions.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

SUCCESS = same real property + correct selected building/roof + exact panel count + exact matrix + clearly readable white-outlined aerial PV array.${correctionBlock}`;
  }

  if (dp === 3) {
    return `Create a genuine French planning DP3 PLAN EN COUPE from the supplied REAL photograph of the project house.

ADMINISTRATIVE PURPOSE:
- Produce an architectural SECTION drawing, not a photorealistic edited photograph and not a perspective beauty render.
- Reconstruct the visible building form faithfully from the source photo: terrain profile, exterior volume, roof type, roof slopes, ridge/eaves and the roof plane carrying the PV project.
- The source photo is visual evidence for SHAPE only. Do not fabricate hidden architecture that contradicts what is visible.
- Show the photovoltaic installation attached to the correct roof plane in section/elevation logic.
- Dimension the PV installation using ONLY known facts: module dimensions and the exact computed field size ${c.fieldWidthMm} x ${c.fieldHeightMm} mm.
- You may label module dimensions ${c.panel.widthMm} x ${c.panel.heightMm} mm and the PV field dimensions.
- NEVER invent a building height, terrain elevation, roof length, roof angle, setback or any other numeric dimension that is absent from authoritative facts.
- If a building dimension is unknown, keep the drawing proportional and leave that dimension unlabeled.
- Use clean architectural linework, section hatching where useful, clear labels and a neutral light background suitable for a mairie dossier.

${array.text}

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

SUCCESS = a recognisable and technically coherent section of the real house, with the PV installation represented and only provable dimensions written on the sheet.${correctionBlock}`;
  }

  if (dp === 4) {
    return `Create a genuine French planning DP4 PLANS DES FACADES ET DES TOITURES — ETAT INITIAL ET ETAT PROJETE from the supplied REAL photograph.

ADMINISTRATIVE PURPOSE:
- This must be an architectural before/after presentation, clearly different from DP5 and DP6.
- Build a clean two-state sheet: ETAT INITIAL and ETAT PROJETE.
- Preserve the same facade composition, roof form, openings, shutters, doors, windows, chimneys, roof windows, gutters and visible materials from the source evidence.
- In ETAT INITIAL, show the building without PV panels.
- In ETAT PROJETE, add the exact PV configuration to the correct visible roof plane.
- Do not turn this into a landscape/environment photomontage; DP6 has that role.
- If the supplied photograph is insufficient to infer a facade that would need to be shown, do NOT invent a hidden facade. Keep to evidenced elevations and let the Inspector reject for insufficient evidence so PilotPaper can ask for one additional view.

${hardRoofRules(c)}

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

SUCCESS = one clearly readable architectural sheet showing the evidenced facade/roof before and after the project, with exact PV configuration and no invented hidden architecture.${correctionBlock}`;
  }

  if (dp === 5) {
    return `Create a genuine French planning DP5 REPRESENTATION DE L'ASPECT EXTERIEUR from the supplied REAL close project photograph.

ADMINISTRATIVE PURPOSE:
- Show precisely what the exterior of THIS SAME building will look like once the photovoltaic work is complete.
- This is a direct photomontage of the supplied photograph, not an architectural section and not a distant environmental insertion.
- Preserve the original camera position, framing, facade, roof, tiles/slates, doors, windows, shutters, awnings, gutters, vegetation and all existing objects.
- Only add the photovoltaic installation and physically necessary mounting/contact-shadow details.
- The final result must look like THE SAME PHOTOGRAPH taken after installation.

${hardRoofRules(c)}

PHOTOREALISM:
- Match original exposure, white balance, sharpness, grain/compression, light direction and shadows.
- Panels must read as real dark photovoltaic glass with thin frames, subtle reflections and plausible contact shadows; never CGI stickers.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

SUCCESS = a faithful close exterior appearance of the real house after the exact PV installation.${correctionBlock}`;
  }

  if (dp === 6) {
    return `Create a genuine French planning DP6 DOCUMENT GRAPHIQUE D'INSERTION from the supplied REAL contextual project photograph.

ADMINISTRATIVE PURPOSE:
- Show how the completed photovoltaic project fits into its REAL surroundings, neighbouring constructions and landscape.
- This is a photorealistic environmental insertion, not a close-up DP5 and not an architectural DP4 sheet.
- Preserve the original camera position, framing, house, neighbouring buildings, road, vegetation, fences, terrain, sky and landscape exactly as shown.
- Add the PV installation only on the real project roof visible in the scene.
- The project must remain readable at the real camera distance; do not zoom, crop or rebuild the property merely to make panels larger.

${hardRoofRules(c)}

PHOTOREALISM:
- Match the source distance, perspective, atmospheric contrast, sharpness, light, reflections and shadows.
- At distance, panel detail must remain physically plausible and not become oversized or unnaturally crisp.

AUTHORITATIVE PROJECT FACTS:
${projectFacts(c)}

SUCCESS = the same real environmental photograph with a physically believable completed PV project, allowing a mairie reviewer to judge its visual insertion.${correctionBlock}`;
  }

  return `Do not generate a new visual for DP${dp}. Preserve the supplied evidence exactly.${correctionBlock}`;
}

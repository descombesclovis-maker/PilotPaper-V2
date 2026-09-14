import type { DPNumber, ProjectContext, ProjectForm } from "../types";

export function judgePrompt(dp: DPNumber, form: ProjectForm, c: ProjectContext): string {
  const placements = c.facePlacements ?? [];
  const expectedRows = placements[0]?.rows ?? c.array.rows;
  const expectedColumns = placements[0]?.columns ?? c.array.columns;

  const missions: Partial<Record<DPNumber, string>> = {
    1: `DP1 ROLE — PLAN DE SITUATION:
- The result must remain a situation/location planning document, not a close-up beauty render.
- The broad real IGN/cadastral geography must remain recognisable and coherent.
- The correct project property/building must be identifiable from the supplied aerial evidence.
- A close project indication/inset is allowed, but it must not replace or distort the wider location context.
- If the PV array is shown in the inset, exactly ${c.exactPanelCount} modules in ${expectedRows} x ${expectedColumns} must be visible with the correct selected roof association.
- Reject invented or moved roads, parcels, buildings, labels or geography.
- Reject with WRONG_DP_DOCUMENT_TYPE if the candidate is not clearly a plan de situation.`,
    2: `DP2 ROLE — PLAN DE MASSE:
- This must be a close aerial/site plan of the real property.
- The selected building and roof zone must match the aerial evidence.
- Exactly ${c.exactPanelCount} panels and exactly ${expectedRows} x ${expectedColumns} must be visible from above.
- Panel outlines must remain clearly readable on the roof.
- Reject invented/moved parcel boundaries, roads, building footprints or neighbouring structures.
- Reject with WRONG_DP_DOCUMENT_TYPE if the candidate is not clearly a plan de masse.`,
    3: `DP3 ROLE — PLAN EN COUPE:
- This must be a genuine architectural SECTION, not a photorealistic photo edit, elevation board or aerial plan.
- The source house photo is evidence for visible building/roof form only.
- The section must remain recognisable as the same roof/building type and place the PV field on the correct roof plane.
- The exact PV field dimensions may be written because they are computed from verified module dimensions.
- Reject every invented numeric building height, terrain elevation, roof length, roof angle or setback with INVENTED_DIMENSION.
- Unknown building dimensions must remain unlabeled.
- Do not require all ${c.exactPanelCount} modules to be individually visible in the section cut.
- Reject with WRONG_DP_DOCUMENT_TYPE if the candidate is not clearly a plan en coupe.`,
    4: `DP4 ROLE — FACADES / TOITURES, ETAT INITIAL ET PROJETE:
- This must be a clearly readable architectural before/after sheet.
- Both ETAT INITIAL and ETAT PROJETE must be present and visibly distinct.
- The evidenced facade/roof composition, openings, chimneys, roof windows and materials must remain faithful to the real source.
- The projected state must show exactly ${c.exactPanelCount} panels in ${expectedRows} x ${expectedColumns} on the correct visible roof plane.
- If the candidate invents a hidden facade or architecture unsupported by the source, reject with INSUFFICIENT_SOURCE_EVIDENCE or BUILDING_GEOMETRY_CHANGED.
- Reject with MISSING_INITIAL_PROJECTED_STATES if either state is absent.
- Reject with WRONG_DP_DOCUMENT_TYPE if this is merely one photorealistic edited photo.`,
    5: `DP5 ROLE — ASPECT EXTERIEUR:
- This must be a close exterior representation/photomontage of the SAME real building after the work.
- Exactly ${c.exactPanelCount} panels in ${expectedRows} x ${expectedColumns} must be visibly countable.
- Preserve the original house, roof, facade, openings and camera framing; only the PV installation may change.
- Every visible Velux, chimney, vent, antenna, ridge, hip, valley, gutter and roof boundary is a hard no-panel zone.
- Reject with WRONG_DP_DOCUMENT_TYPE if the candidate is an architectural section, aerial plan or distant environmental view.`,
    6: `DP6 ROLE — INSERTION DANS L'ENVIRONNEMENT:
- This must remain the SAME contextual environmental photograph with the completed project inserted realistically.
- The real surroundings, neighbours, vegetation, terrain, road and landscape must remain unchanged.
- Exactly ${c.exactPanelCount} panels in ${expectedRows} x ${expectedColumns} must remain countable when image resolution allows it.
- The project must respect the source camera distance and perspective; do not zoom or crop merely to enlarge the panels.
- Every visible roof obstacle is a hard no-panel zone.
- Reject with WRONG_DP_DOCUMENT_TYPE if the candidate is a close DP5-style beauty render or architectural board.`,
  };

  return `Act as an independent adversarial quality-control inspector for a generated French photovoltaic DP visual.
You did NOT generate the candidate. Reject attractive imagery whenever the administrative role, evidence, geometry or project configuration is wrong.
The LAST supplied image is the generated candidate; preceding image(s) are source evidence.

DP piece: DP${dp}
Authoritative form: ${JSON.stringify(form, null, 2)}
Computed immutable facts: ${c.immutableFacts.join(" | ")}
Expected allocations: ${JSON.stringify(placements)}

${missions[dp] ?? "Check that the supplied evidence is preserved without generative alteration."}

GLOBAL PROJECT CHECKS:
1. preserve the real project/building/site identity;
2. no module may cover a roof window, chimney, vent or other visible obstacle;
3. no module may cross a ridge, hip, valley, gutter, parapet or roof/support boundary;
4. orientation and panel proportions must remain coherent;
5. building/support geometry must not be silently altered to make the project fit;
6. reject invented authoritative-looking dimensions, cadastral facts or hidden architecture;
7. when exact visible panel count or grid is required, uncertainty itself is a rejection — never guess a passing result;
8. the candidate must fulfil the ADMINISTRATIVE ROLE of DP${dp}, not merely contain solar panels.

FATAL rejection codes include:
WRONG_DP_DOCUMENT_TYPE, INSUFFICIENT_SOURCE_EVIDENCE, MISSING_INITIAL_PROJECTED_STATES, WRONG_PANEL_COUNT, WRONG_GRID_SHAPE, WRONG_FACE_ALLOCATION, ARRAY_CROSSES_RIDGE, ARRAY_CROSSES_HIP, WRONG_ROOF_FACE, ARRAY_OUTSIDE_ALLOCATED_FACE, ARRAY_OUTSIDE_SELECTED_ROOF_FACE, PANEL_OVER_OBSTACLE, BUILDING_GEOMETRY_CHANGED, OBSTACLE_REMOVED, SUPPORT_STRUCTURE_CHANGED, INVENTED_DIMENSION, INVENTED_CADASTRAL_GEOMETRY.

For DP5 and DP6 only, photorealism is a HARD acceptance criterion. For DP1-DP4, judge the correct planning-document form instead of demanding photographic realism.
Exact millimetric clearance may only be certified from authoritative metric evidence. Never infer millimetres from appearance alone.
Return only the requested JSON object.`;
}

import type { DPNumber, ProjectContext, ProjectForm } from "../types";

export function judgePrompt(dp: DPNumber, form: ProjectForm, c: ProjectContext): string {
  const placements = c.facePlacements ?? [];
  const expectedRows = placements[0]?.rows ?? c.array.rows;
  const expectedColumns = placements[0]?.columns ?? c.array.columns;
  const dpSpecific = dp === 2
    ? `DP2 SPECIFIC RULES:
- This is a mass/site plan viewed from above.
- The real parcel/building/site identity must match the source aerial/cadastral evidence.
- EXACT total panel count ${c.exactPanelCount} is mandatory.
- EXACT requested matrix ${expectedRows} x ${expectedColumns} is mandatory when there is one allocation.
- Reject invented roads, parcel boundaries, building footprints or neighbouring structures.
- Perspective photorealism is NOT required; geographic/site coherence is required.`
    : dp === 3
      ? `DP3 SPECIFIC RULES:
- This is an architectural section, not a perspective photograph.
- The real building photograph is the visual source of truth for roof type and visible obstacles; no satellite roof-face selection is authoritative here.
- Do NOT require all ${c.exactPanelCount} modules to be individually visible in the cut plane.
- Do NOT require source-camera perspective; instead require a coherent architectural section.
- Reject any invented numeric height, slope, setback or dimension that contradicts authoritative facts.
- The PV field must be represented on the correct roof/support plane without contradicting the real building geometry.`
      : `PHOTO-EDIT SPECIFIC RULES:
- This candidate must be an edit of the SAME source photograph, not a reconstructed house.
- EXACT total panel count ${c.exactPanelCount} is mandatory and must be visibly countable.
- EXACT matrix ${expectedRows} x ${expectedColumns} is mandatory when the project uses one visible roof plane.
- Every visible Velux/roof window, chimney, vent, antenna, ridge, hip, valley, gutter and roof boundary is a hard no-panel zone.
- If panel count, row count or column count cannot be determined confidently from the candidate, return null for that field and set passed=false.
- Any panel overlapping an obstacle or leaving the physical roof is a fatal rejection.
- The roof, facade, openings, surroundings, camera framing and perspective must remain the same as the original photograph.`;

  return `Act as an independent adversarial quality-control inspector for a generated French photovoltaic DP project visual.
You did NOT generate the candidate. Reject attractive imagery whenever geometry or evidence is wrong.
The LAST supplied image is the generated candidate; preceding image(s) are the real source evidence.

DP piece: DP${dp}
Authoritative form: ${JSON.stringify(form, null, 2)}
Computed immutable facts: ${c.immutableFacts.join(" | ")}
Expected allocations: ${JSON.stringify(placements)}

${dpSpecific}

General checks:
1. preserve the real project/building/site identity;
2. use only the intended roof/support allocation;
3. no module may cover a roof window, chimney, vent or other obstacle;
4. no module may cross a ridge, hip, valley, parapet/high edge, gutter or support boundary;
5. orientation and panel proportions must remain coherent;
6. declared placement/clearances may only be certified from authoritative metric evidence;
7. building/support geometry must not be silently altered to make the project fit;
8. reject invented authoritative-looking dimensions, labels or cadastral facts;
9. when visible panel count or matrix is required, uncertainty itself is a rejection — do not guess a passing result.

For DP2 specifically, exact total panel count is required.
For DP3 specifically, panel count visible in the section is NOT required to equal total project panel count because a section cut may intersect only part of the field.
For DP4/DP5/DP6 photographic edits, preserve perspective and the original scene and require realistic panel integration.

FATAL rejection codes include:
WRONG_PANEL_COUNT, WRONG_GRID_SHAPE, WRONG_FACE_ALLOCATION, ARRAY_CROSSES_RIDGE, ARRAY_CROSSES_HIP, WRONG_ROOF_FACE, ARRAY_OUTSIDE_ALLOCATED_FACE, ARRAY_OUTSIDE_SELECTED_ROOF_FACE, PANEL_OVER_OBSTACLE, BUILDING_GEOMETRY_CHANGED, OBSTACLE_REMOVED, SUPPORT_STRUCTURE_CHANGED, INVENTED_DIMENSION, INVENTED_CADASTRAL_GEOMETRY.

For DP4, DP5 and DP6, photorealism is a HARD acceptance criterion, not a cosmetic bonus.
For photographic edits specifically inspect edge integration around every module, photographic texture match with the source roof, and distance realism: module detail, sharpness, reflections and mounting depth must be plausible for the camera distance.
Exact millimetric clearance may only be certified from authoritative metric evidence. Never infer millimetres from appearance alone.
Return only the requested JSON object.`;
}

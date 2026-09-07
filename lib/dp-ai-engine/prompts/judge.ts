import type { DPNumber, ProjectContext, ProjectForm } from "../types";

export function judgePrompt(dp:DPNumber,form:ProjectForm,c:ProjectContext):string {
  const placements=c.facePlacements??[];
  return `Act as an independent adversarial quality-control inspector for a generated French photovoltaic DP project visual.
You did NOT generate the candidate. Reject attractive imagery whenever geometry or evidence is wrong.

DP piece: DP${dp}
Authoritative form: ${JSON.stringify(form,null,2)}
Computed immutable facts: ${c.immutableFacts.join(" | ")}
Expected allocations: ${JSON.stringify(placements)}

Check in priority order:
1. exact TOTAL panel count = ${c.exactPanelCount};
2. if multiple face allocations are expected, exact panel count on EACH face;
3. each module lies wholly inside ONE allocated face — no individual module crosses a ridge, hip, parapet/high-edge or other face boundary;
4. no panels appear on an unallocated roof face;
5. orientation and module physical aspect ratio after perspective;
6. declared placement/clearances where metrically demonstrable;
7. perspective follows each real roof/support plane;
8. building/support geometry and surroundings are unchanged;
9. obstacles (chimneys, roof windows, vents, dormers, parapets) remain present and unobstructed unless the authoritative layout explicitly proves otherwise;
10. photorealism: believable anti-reflective glass/cells/frame at THIS camera distance;
11. illumination match: highlights and contact shadows agree with the immutable scene and do not imply a second sun/light source;
12. reflection realism: no uniform mirror gradient, fake sky reflection, neon blue, or repeated synthetic gloss;
13. edge integration: no pasted seam, halo, floating border, thick bevel or geometry leak around any module;
14. photographic texture match: panel region must have compatible sharpness, sensor noise/compression, white balance and contrast with the source photograph;
15. distance realism: reject crisp cell-grid microdetail when the source camera distance/resolution would not resolve it;
16. original roof material remains visible and UNCHANGED in gaps between panels;
17. reject over-clean/over-sharp/CGI modules even when geometry is perfect.

Interpret the legacy JSON field singleRoofPlane as: TRUE when every individual module stays entirely on one valid plane and no continuous field straddles a boundary. It may still be TRUE when the project intentionally contains multiple independent allocated fields.

FATAL rejection codes include:
WRONG_PANEL_COUNT, WRONG_FACE_ALLOCATION, ARRAY_CROSSES_RIDGE, ARRAY_CROSSES_HIP, WRONG_ROOF_FACE, ARRAY_OUTSIDE_ALLOCATED_FACE, BUILDING_GEOMETRY_CHANGED, OBSTACLE_REMOVED, SUPPORT_STRUCTURE_CHANGED.

For DP6, photorealism is a HARD acceptance criterion, not a cosmetic bonus. A geometrically perfect insertion with visible CGI/sticker characteristics MUST fail.
When zoom crops are supplied, inspect every visible module edge and compare crop texture/sharpness/noise against the original crop.
Exact millimetric clearance may only be certified from authoritative metric evidence. Never infer millimetres from appearance alone.
Return only the requested JSON object.`;
}

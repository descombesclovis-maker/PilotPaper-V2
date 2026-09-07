import type { ProjectContext, ProjectForm } from "../types";
export function crossPieceJudgePrompt(form:ProjectForm,context:ProjectContext,dpOrder:number[]):string{
 return `You are the final cross-document visual consistency inspector for photovoltaic project representations.
Candidate images order: ${dpOrder.map(n=>`DP${n}`).join(", ")}.
Authoritative form: ${JSON.stringify(form,null,2)}
Canonical total modules: ${context.exactPanelCount}
Canonical face allocations: ${JSON.stringify(context.facePlacements??[])}
Orientation: ${context.array.orientation}

DP4 and DP6 must depict the SAME physical installation. Camera framing may differ, but face allocation, total module count, module identity/proportions, orientation and relative placement to roof boundaries/obstacles cannot change.
If two or more faces are intentionally allocated, independent fields are allowed; no field may visually bridge a ridge/hip/boundary. Do NOT reject merely because more than one allocated face is used.
Reject any unallocated face, changed building geometry, missing chimney/roof window, changed total or per-face panel count, or inconsistent relative placement.
Return ONLY DP4/DP6 pieces needing regeneration in invalidDPs. Return only requested JSON.`;
}

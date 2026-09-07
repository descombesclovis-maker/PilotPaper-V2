import type { ProjectForm } from "../types";
export function environmentPhotoJudgePrompt(dp:7|8,form:ProjectForm){
  const close=dp===7;
  return `Act as a strict evidence inspector for DP${dp} of a French prior-declaration dossier.
The supplied image MUST remain an authentic source photograph; do not request or reward image editing.
Project address: ${form.address}
DP${dp} purpose: ${close?"situate the land/building in the immediate environment (adjacent buildings, vegetation, immediate street/terrain)":"situate the land/building in the distant landscape/general street or rural surroundings"}.
Check that the photograph is plausibly of the same project property as the other project evidence, has enough context for its DP purpose, is not an extreme crop, and is visually usable.
Panel count is NOT applicable to DP7/DP8 and must be null. Geometry booleans can be true when the photograph is authentic/usable; do not hallucinate project geometry into this source photo.
Reject if it is obviously the wrong property, too close/too distant for its purpose, severely blurred/occluded, or synthetic/edited.
Return only the required JSON.`;
}

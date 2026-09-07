import type { DPNumber, ProjectContext } from "../types";

export function dpImagePrompt(dp:DPNumber,c:ProjectContext,correction?:string):string {
  const purpose:Partial<Record<DPNumber,string>>={
    4:"Produce the proposed facade/roof representation while keeping the same building and the exact canonical PV allocations.",
    6:"Create a highly photorealistic insertion of the photovoltaic arrays into the supplied real project photograph."
  };
  const placements=c.facePlacements??[];
  const faceRules=placements.length>1
    ? `This project intentionally uses ${placements.length} distinct roof/support planes. This is allowed ONLY because the deterministic allocator assigned separate fields.\n${placements.map(p=>`- Face ${p.faceId}: exactly ${p.panelCount} modules; ${p.rows} row(s), up to ${p.columns} columns; final row ${p.lastRowCount}; lower-edge clearance ${Math.round(p.resolvedGutterMm)} mm.`).join("\n")}\nNever visually connect fields across a ridge/hip/boundary.`
    : `Use only the allocated roof/support plane. Keep every module entirely inside it. The ridge/high edge is a hard boundary.`;
  return `${purpose[dp]??"Create the requested DP project visual."}

AUTHORITATIVE PROJECT CONSTRAINTS — DO NOT OVERRIDE:
${c.immutableFacts.map(x=>`- ${x}`).join("\n")}

ALLOCATED-FACE RULES:
${faceRules}

Photographic rules:
- The supplied real photograph is the immutable base scene.
- Preserve walls, roof outline, gutters, ridge/hips/high edges, openings, chimneys, roof windows, vents, parapets, vegetation, neighboring buildings, posts/beams, camera position and lens perspective.
- Panels must follow each actual allocated plane and its vanishing geometry.
- Maintain physical module aspect ratio after perspective projection; never make panels square/oversized to fill the mask.
- Result must be indistinguishable from a real photograph taken AFTER installation, not a render, pasted sticker or CGI composite.
- Match the ORIGINAL CAMERA RESPONSE: local sharpness/blur, sensor noise, JPEG-like compression character, white balance, contrast, exposure, dynamic range and color saturation. Do not create panels that are cleaner or sharper than the surrounding roof.
- Infer the dominant illumination direction from the immutable scene. Panel highlights, frame brightness and contact shadows must obey that same illumination; do not invent a second light source.
- Photovoltaic glass must be dark blue-black/charcoal with restrained anti-reflective behavior. Reflections must be subtle, spatially coherent and consistent with the visible sky/environment; never use uniform mirror gradients.
- Cell/busbar detail must be visible ONLY to the degree justified by camera distance and source resolution. At distance, prefer subtle tonal structure over crisp synthetic grid lines.
- Frames must be physically thin and perspective-consistent. Mounting depth/contact gap must be visually plausible and produce only a small natural contact shadow.
- Preserve small photographic imperfections: slight lens softness, perspective falloff and roof-surface irregularity should remain consistent across panel boundaries.
- Never erase obstacles or reconstruct unrelated architecture.
- The mask marks the ONLY pixels that may change.
- When mask consists of separate module islands, their polygons are AUTHORITATIVE: do not move, enlarge, shrink, rotate, merge or reconnect them.
- Only photorealize those exact islands: realistic anti-reflective photovoltaic glass, distance-appropriate cell structure, thin plausible frame, roof-consistent highlights, tiny contact shadows and matching exposure.
- The narrow editable halo around each island exists ONLY for edge blending/contact shadow. Never use it to enlarge, translate or reshape a module.
- Preserve original tile/slate/zinc/steel/membrane texture in every gap between modules.
- On bac acier/steel sheet, preserve ribs/corrugations in the gaps and do not reinterpret them as ridges.
- Avoid mirror-like glass, fake neon blue, excessive reflections, perfectly uniform repeated textures, floating edges, thick CGI bevels, razor-sharp pasted boundaries, synthetic uniform lighting, over-clean modules or oversaturated blacks.
- PASS condition: if an inspector zooms in around module edges, there must be no obvious seam, halo, floating edge, mismatch of grain/sharpness, or physically impossible reflection.
${correction?`\nMANDATORY CORRECTION FROM QA:\n${correction}`:""}`;
}

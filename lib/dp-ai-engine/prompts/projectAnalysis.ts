import type { ProjectForm } from "../types";
import { requestedPanelCount } from "../geometry/projectLayout";
import { supportRules } from "../geometry/supportRules";

export function projectAnalysisPrompt(form: ProjectForm): string {
  const count=requestedPanelCount(form);
  const rules=supportRules(form.support?.topology??"unknown",form.support?.covering??"unknown");
  return `You are the vision-analysis stage of a French photovoltaic prior-declaration document generator.
Analyze ALL supplied images as evidence of the SAME property. Do not design, render, beautify or invent anything.

Authoritative form data:
${JSON.stringify(form, null, 2)}

Hard facts:
- requested total modules: ${count}
- physical module size: ${form.panel.widthMm} × ${form.panel.heightMm} mm
- module orientation: ${form.array.orientation}
- support topology: ${form.support?.topology ?? "unknown"}
- covering: ${form.support?.covering ?? "unknown"}
- roof-selection mode: ${form.roofSelection?.mode ?? "automatic"}
${form.roofSelection?.priorityFaceId?`- priority face: ${form.roofSelection.priorityFaceId}`:""}

CROSS-VIEW IDENTITY IS CRITICAL:
- First match the SAME physical building and the SAME physical roof plane across the authoritative image roles before assigning face IDs.
- A face visible in both satellite_mass and roof evidence MUST keep one identical face ID across those views. Never create a separate ID merely because the camera angle changed.
- In isolated DP2, satellite_mass is the official metric view centered on the target cadastral parcel and roof is the real project photograph. Use roof shape, ridge/eave axis, obstacle placement, annexes and relative proportions to establish correspondence.
- Ignore neighboring roofs that do not correspond to the real roof photograph, even when they are visible in the metric image.
- If the correspondence is genuinely ambiguous, lower confidence and report the ambiguity; do not silently attach the roof photograph to a different building.

DETECT ALL DISTINCT USABLE ROOF/SUPPORT PLANES OF THE TARGET BUILDING, not one merged roof silhouette.
Assign stable IDs A, B, C... consistently across views. If form.roofFaces already provides IDs, preserve those IDs.
For EACH face and EACH view where it is visible, return that face polygon in normalized 0..1 image coordinates.
When a face is quadrilateral, order points as lower-edge-left, lower-edge-right, upper-edge-right, upper-edge-left relative to that plane. Never merge two slopes separated by a ridge/hip.
Identify gutter/low edge and ridge/high edge when applicable. A boundary between faces is hard: modules may be allocated independently to both faces, but no individual module or continuous panel polygon may cross it.

OBSTACLES: report chimneys, roof windows, vents, dormers, parapets and other real exclusion zones, attached to the correct face and view. Never erase an obstacle merely because the requested quantity is large.
When the same obstacle can be identified in more than one view, keep it attached to the SAME face. Do not duplicate one physical chimney or roof window as unrelated obstacles on different face IDs.

MATERIAL/TOPOLOGY RULES:
${rules.visualWarnings.map(x=>`- ${x}`).join("\n")}
- On steel sheet / bac acier, repeated ribs/corrugations are texture, NOT ridges and NOT separate roof planes.
- On mono-pitch roofs/carports, do not invent an opposite slope.
- On flat roofs, do not invent a ridge; preserve real parapets and edges.
- On hipped roofs, each hip-separated plane is distinct.

METRIC RULE:
Never invent an exact roof dimension from ordinary perspective photos. Satellite/orthographic imagery may be used for geometry only when its scale is supplied by the host. Otherwise list uncertainty.
Return only the requested structured object.`;
}

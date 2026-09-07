import type { DPNumber, GeneratedAsset, ProjectContext, ProjectForm } from "../types";

// These are structured source payloads, intentionally not hallucinated raster maps.
// The host application can render them using IGN/cadastre adapters or its existing document layer.
export function buildNonVisualDP(dp: 1|2|3, form: ProjectForm, context: ProjectContext): GeneratedAsset {
  const payload = dp === 1 ? {
    type:"situation-plan-request", address:form.address, parcelReference:form.parcelReference ?? null,
    required:["official geocoding","north arrow","scale","site marker"]
  } : dp === 2 ? {
    type:"mass-plan-request", address:form.address, parcelReference:form.parcelReference ?? null,
    pv:{roofFace:context.array.roofFace, fieldWidthMm:context.fieldWidthMm, fieldHeightMm:context.fieldHeightMm, count:context.exactPanelCount},
    required:["cadastral parcel geometry","building footprint","north arrow","scale","PV location"]
  } : {
    type:"section-plan-request", address:form.address,
    pv:{panel:context.panel,array:context.array, fieldWidthMm:context.fieldWidthMm,fieldHeightMm:context.fieldHeightMm},
    required:["roof slope/section derived from reliable project data","dimensions","existing/proposed distinction"]
  };
  return { dp:dp as DPNumber, kind:"json", mimeType:"application/json", text:JSON.stringify(payload,null,2), attempt:1 };
}

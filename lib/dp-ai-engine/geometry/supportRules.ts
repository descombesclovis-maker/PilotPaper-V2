export type RoofTopology = "gable"|"mono_pitch"|"hipped"|"flat"|"carport"|"canopy"|"unknown";
export type RoofCovering = "tile"|"slate"|"steel_sheet"|"zinc"|"membrane"|"other"|"unknown";

export interface SupportRules {
  topology: RoofTopology;
  covering: RoofCovering;
  canUseMultipleFaces: boolean;
  upperBoundary: "ridge"|"high_edge"|"parapet_or_edge";
  lowerBoundary: "gutter"|"low_edge"|"parapet_or_edge";
  panelPlane: "parallel_to_roof"|"rack_defined";
  visualWarnings: string[];
}

export function supportRules(topology:RoofTopology="unknown",covering:RoofCovering="unknown"):SupportRules {
  const multi=topology==="gable"||topology==="hipped";
  const flat=topology==="flat";
  const mono=topology==="mono_pitch"||topology==="carport"||topology==="canopy";
  return {
    topology,covering,canUseMultipleFaces:multi,
    upperBoundary: flat?"parapet_or_edge":mono?"high_edge":"ridge",
    lowerBoundary: flat?"parapet_or_edge":mono?"low_edge":"gutter",
    panelPlane: flat?"rack_defined":"parallel_to_roof",
    visualWarnings:[
      ...(covering==="steel_sheet"?["Steel-sheet ribs/corrugations are surface texture, never roof ridges or separate roof faces."]:[]),
      ...(flat?["Do not invent a pitched ridge on a flat roof; use real parapets/edges and the declared rack tilt if any."]:[]),
      ...(mono?["This support has no opposite roof slope across a ridge unless another independently detected face exists."]:[]),
      ...((topology==="carport"||topology==="canopy")?["Preserve posts, beams and the exact existing carport/canopy footprint; never invent a larger supporting structure."]:[]),
    ]
  };
}

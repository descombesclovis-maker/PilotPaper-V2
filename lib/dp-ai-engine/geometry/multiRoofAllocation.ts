import type { PanelSpec } from "../types";

export interface RoofFaceCandidate {
  id: string;
  label?: string;
  widthMm: number;
  slopeLengthMm: number;
  /** optional obstacle-reserved area expressed conservatively as whole unusable module cells */
  blockedCells?: number;
}

export interface FaceAllocation {
  faceId: string;
  panelCount: number;
  rows: number;
  columns: number;
  lastRowCount: number;
  preferredGutterMm: number;
  resolvedGutterMm: number;
  resolvedRidgeMm: number;
  capacity: number;
}

export interface MultiRoofAllocationResult {
  fits: boolean;
  requested: number;
  allocated: number;
  allocations: FaceAllocation[];
  remaining: number;
  reasons: string[];
}

function oriented(panel:PanelSpec, orientation:"portrait"|"landscape") {
  return orientation === "portrait"
    ? {w:panel.widthMm,h:panel.heightMm}
    : {w:panel.heightMm,h:panel.widthMm};
}

export function faceCapacity(
  panel:PanelSpec,
  orientation:"portrait"|"landscape",
  face:RoofFaceCandidate,
  gapMm=20,
  preferredGutterMm=300,
  minimumRidgeMm=0,
) {
  const {w,h}=oriented(panel,orientation);
  const columns=Math.max(0,Math.floor((face.widthMm+gapMm)/(w+gapMm)));
  const usableSlope=Math.max(0,face.slopeLengthMm-Math.max(0,minimumRidgeMm));
  // The gutter value is a preference. Capacity may reduce it to zero, but the
  // requested ridge/high-edge clearance remains a hard geometric minimum.
  const rowsAtZero=Math.max(0,Math.floor((usableSlope+gapMm)/(h+gapMm)));
  const rowsAtPreferred=Math.max(0,Math.floor((Math.max(0,usableSlope-preferredGutterMm)+gapMm)/(h+gapMm)));
  const gross=columns*rowsAtZero;
  const capacity=Math.max(0,gross-Math.max(0,face.blockedCells??0));
  return {columns,rowsAtZero,rowsAtPreferred,capacity};
}

function allocationFor(
  face:RoofFaceCandidate,
  count:number,
  panel:PanelSpec,
  orientation:"portrait"|"landscape",
  gapMm:number,
  preferredGutterMm:number,
  minimumRidgeMm:number,
):FaceAllocation {
  const cap=faceCapacity(panel,orientation,face,gapMm,preferredGutterMm,minimumRidgeMm);
  const columns=Math.max(1,Math.min(cap.columns,count));
  const rows=Math.ceil(count/columns);
  const lastRowCount=count-(rows-1)*columns;
  const {h}=oriented(panel,orientation);
  const fieldHeight=rows*h+Math.max(0,rows-1)*gapMm;
  const maxGutter=face.slopeLengthMm-Math.max(0,minimumRidgeMm)-fieldHeight;
  const resolvedGutterMm=Math.min(preferredGutterMm,Math.max(0,maxGutter));
  const resolvedRidgeMm=face.slopeLengthMm-resolvedGutterMm-fieldHeight;
  return {
    faceId:face.id,
    panelCount:count,
    rows,
    columns,
    lastRowCount,
    preferredGutterMm,
    resolvedGutterMm,
    resolvedRidgeMm,
    capacity:cap.capacity,
  };
}

/**
 * Deterministic multi-plane allocator.
 * - automatic: first tries to keep the entire request on one face; otherwise fills faces by capacity.
 * - priority: fills the user-selected face first, then allocates only the surplus to the remaining faces.
 * No allocation ever straddles a ridge: every FaceAllocation is an independent field.
 */
export function allocateAcrossRoofFaces(args:{
  panel:PanelSpec;
  totalPanels:number;
  orientation:"portrait"|"landscape";
  faces:RoofFaceCandidate[];
  mode:"automatic"|"priority";
  priorityFaceId?:string;
  gapMm?:number;
  preferredGutterMm?:number;
  minimumRidgeMm?:number;
}):MultiRoofAllocationResult {
  const {panel,totalPanels,orientation}=args;
  const gapMm=args.gapMm??20;
  const preferred=Math.max(0,args.preferredGutterMm??300);
  const minimumRidge=Math.max(0,args.minimumRidgeMm??0);
  if(totalPanels<=0) return {fits:false,requested:totalPanels,allocated:0,allocations:[],remaining:totalPanels,reasons:["Requested panel quantity must be positive."]};
  const capacities=new Map(args.faces.map(f=>[f.id,faceCapacity(panel,orientation,f,gapMm,preferred,minimumRidge).capacity]));
  let ordered=[...args.faces];
  if(args.mode==="priority") {
    const idx=ordered.findIndex(f=>f.id===args.priorityFaceId);
    if(idx<0) return {fits:false,requested:totalPanels,allocated:0,allocations:[],remaining:totalPanels,reasons:["Priority roof face is not available."]};
    ordered=[ordered[idx]!,...ordered.filter((_,i)=>i!==idx)];
  } else {
    // Prefer a single face if one can contain everything. Otherwise use the largest capacities first.
    const single=ordered.filter(f=>(capacities.get(f.id)??0)>=totalPanels).sort((a,b)=>(capacities.get(b.id)??0)-(capacities.get(a.id)??0))[0];
    if(single) ordered=[single,...ordered.filter(f=>f.id!==single.id)];
    else ordered.sort((a,b)=>(capacities.get(b.id)??0)-(capacities.get(a.id)??0));
  }

  let remaining=totalPanels;
  const allocations:FaceAllocation[]=[];
  for(const face of ordered){
    if(remaining<=0) break;
    const capacity=capacities.get(face.id)??0;
    if(capacity<=0) continue;
    const count=Math.min(remaining,capacity);
    allocations.push(allocationFor(face,count,panel,orientation,gapMm,preferred,minimumRidge));
    remaining-=count;
  }
  const allocated=totalPanels-remaining;
  return {
    fits:remaining===0,
    requested:totalPanels,
    allocated,
    allocations,
    remaining,
    reasons:remaining===0?[]:[`Only ${allocated} of ${totalPanels} requested modules fit across the available roof faces while preserving the requested ridge clearance.`],
  };
}

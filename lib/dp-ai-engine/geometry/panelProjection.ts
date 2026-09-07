import type { Point2D, ProjectContext, RoofViewObservation } from "../types";

function bilinear(q:Point2D[],u:number,v:number):Point2D {
  const [bl,br,tr,tl]=q;
  if(!bl||!br||!tr||!tl) throw new Error("A four-corner roof/support quad is required for metric panel projection.");
  const bottom={x:bl.x+(br.x-bl.x)*u,y:bl.y+(br.y-bl.y)*u};
  const top={x:tl.x+(tr.x-tl.x)*u,y:tl.y+(tr.y-tl.y)*u};
  return {x:bottom.x+(top.x-bottom.x)*v,y:bottom.y+(top.y-bottom.y)*v};
}

function rowLeftMm(context:ProjectContext,roofWidthMm:number,rowWidthMm:number,placementLeftMm?:number,placementRightMm?:number) {
  if(context.array.placement==="left") return Math.max(0,placementLeftMm??context.array.leftEdgeClearanceMm??0);
  if(context.array.placement==="right") return Math.max(0,roofWidthMm-rowWidthMm-Math.max(0,placementRightMm??context.array.rightEdgeClearanceMm??0));
  if(context.array.placement==="custom") {
    if(placementLeftMm!=null) return placementLeftMm;
    if(context.array.leftEdgeClearanceMm!=null) return context.array.leftEdgeClearanceMm;
    if(placementRightMm!=null) return roofWidthMm-rowWidthMm-placementRightMm;
    if(context.array.rightEdgeClearanceMm!=null) return roofWidthMm-rowWidthMm-context.array.rightEdgeClearanceMm;
  }
  return Math.max(0,(roofWidthMm-rowWidthMm)/2);
}

export function panelPolygonsForView(context:ProjectContext,view:RoofViewObservation):Point2D[][]|undefined {
  const q=view.roofPolygonNormalized;
  if(q.length!==4) return undefined;
  const placement=(context.facePlacements??[]).find(p=>p.faceId===view.faceId) ?? context.facePlacements?.[0];
  if(!placement) {
    const roof=context.roofGeometry, resolved=context.resolvedPlacement;
    if(!roof?.widthMm||!roof.slopeLengthMm||!resolved) return undefined;
    const panelW=context.array.orientation==="portrait"?context.panel.widthMm:context.panel.heightMm;
    const panelH=context.array.orientation==="portrait"?context.panel.heightMm:context.panel.widthMm;
    const gap=context.array.interPanelGapMm??20;
    const polys:Point2D[][]=[];
    for(let row=0;row<context.array.rows;row++) for(let col=0;col<context.array.columns;col++){
      const x0=resolved.leftMm+col*(panelW+gap),x1=x0+panelW;
      const y0=resolved.gutterMm+row*(panelH+gap),y1=y0+panelH;
      const vals=[x0/roof.widthMm,x1/roof.widthMm,y0/roof.slopeLengthMm,y1/roof.slopeLengthMm];
      if(vals.some(n=>n<0||n>1)) return undefined;
      polys.push([bilinear(q,vals[0]!,vals[2]!),bilinear(q,vals[1]!,vals[2]!),bilinear(q,vals[1]!,vals[3]!),bilinear(q,vals[0]!,vals[3]!)]);
    }
    return polys;
  }

  const panelW=context.array.orientation==="portrait"?context.panel.widthMm:context.panel.heightMm;
  const panelH=context.array.orientation==="portrait"?context.panel.heightMm:context.panel.widthMm;
  const gap=context.array.interPanelGapMm??20;
  const roofW=placement.widthMm,roofH=placement.slopeLengthMm;
  const polys:Point2D[][]=[];
  let emitted=0;
  for(let row=0;row<placement.rows&&emitted<placement.panelCount;row++){
    const rowCount=row===placement.rows-1?placement.lastRowCount:Math.min(placement.columns,placement.panelCount-emitted);
    const rowWidth=rowCount*panelW+Math.max(0,rowCount-1)*gap;
    // Partial rows are centered within the resolved full-field corridor unless the
    // user explicitly requested left/right/custom alignment. This keeps symmetry
    // stable while preserving deterministic edge clearances.
    const fullRowWidth=placement.columns*panelW+Math.max(0,placement.columns-1)*gap;
    const corridorLeft=rowLeftMm(context,roofW,fullRowWidth,placement.resolvedLeftMm,placement.resolvedRightMm);
    const partialOffset=context.array.placement==="centered"?Math.max(0,(fullRowWidth-rowWidth)/2):0;
    const left=corridorLeft+partialOffset;
    for(let col=0;col<rowCount&&emitted<placement.panelCount;col++){
      const x0=left+col*(panelW+gap),x1=x0+panelW;
      const y0=placement.resolvedGutterMm+row*(panelH+gap),y1=y0+panelH;
      const u0=x0/roofW,u1=x1/roofW,v0=y0/roofH,v1=y1/roofH;
      if([u0,u1,v0,v1].some(n=>n<0||n>1)) return undefined;
      polys.push([bilinear(q,u0,v0),bilinear(q,u1,v0),bilinear(q,u1,v1),bilinear(q,u0,v1)]);
      emitted++;
    }
  }
  return emitted===placement.panelCount?polys:undefined;
}

/** All expected module polygons in one image role, across every independently allocated face. */
export function allPanelPolygonsForRole(context:ProjectContext,role:RoofViewObservation["role"]):Point2D[][]|undefined {
  const placements=context.facePlacements??[];
  if(!placements.length){
    const view=context.roof.views?.find(v=>v.role===role&&v.selectedFaceVisible);
    return view?panelPolygonsForView(context,view):undefined;
  }
  const out:Point2D[][]=[];
  for(const p of placements){
    const view=context.roof.views?.find(v=>v.role===role&&v.faceId===p.faceId&&v.selectedFaceVisible);
    if(!view) continue;
    const polys=panelPolygonsForView(context,view);
    if(!polys) return undefined;
    out.push(...polys);
  }
  return out.length?out:undefined;
}

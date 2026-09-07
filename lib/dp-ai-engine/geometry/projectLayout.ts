import type { FacePlacement, ProjectForm, RoofFaceMetricGeometry } from "../types";
import { allocateAcrossRoofFaces } from "./multiRoofAllocation";
import { computePVField, checkSingleRoofPlaneFit } from "./pvConstraints";

export function requestedPanelCount(form:ProjectForm):number {
  const fallback=form.array.rows*form.array.columns;
  const n=Math.trunc(form.requestedPanelCount ?? fallback);
  if(!Number.isFinite(n)||n<1) throw new Error("Requested photovoltaic module quantity must be a positive integer.");
  return n;
}

function lateralClearances(form:ProjectForm, roofWidthMm:number, fieldWidthMm:number) {
  const remaining=roofWidthMm-fieldWidthMm;
  if(remaining<0) return {leftMm:remaining/2,rightMm:remaining/2};
  const requestedLeft=form.array.leftEdgeClearanceMm;
  const requestedRight=form.array.rightEdgeClearanceMm;
  if(form.array.placement==="left") {
    const left=Math.max(0,requestedLeft??0);
    return {leftMm:left,rightMm:roofWidthMm-fieldWidthMm-left};
  }
  if(form.array.placement==="right") {
    const right=Math.max(0,requestedRight??0);
    return {leftMm:roofWidthMm-fieldWidthMm-right,rightMm:right};
  }
  if(form.array.placement==="custom") {
    if(requestedLeft!=null) return {leftMm:requestedLeft,rightMm:roofWidthMm-fieldWidthMm-requestedLeft};
    if(requestedRight!=null) return {leftMm:roofWidthMm-fieldWidthMm-requestedRight,rightMm:requestedRight};
  }
  return {leftMm:remaining/2,rightMm:remaining/2};
}

export function resolveProjectLayout(form:ProjectForm):{
  count:number;
  placements:FacePlacement[];
  primaryFieldWidthMm:number;
  primaryFieldHeightMm:number;
  split:boolean;
} {
  const count=requestedPanelCount(form);
  const gap=form.array.interPanelGapMm??20;
  const preferred=form.array.gutterClearanceMm??300;
  const ridgeMinimum=Math.max(0,form.array.ridgeClearanceMm??0);
  const faces=(form.roofFaces??[]).filter(f=>(f.widthMm??0)>0&&(f.slopeLengthMm??0)>0) as Array<RoofFaceMetricGeometry & {widthMm:number;slopeLengthMm:number}>;

  if(faces.length){
    // If the user explicitly supplied an exact matrix (e.g. 2×6), preserve it
    // whenever that complete matrix fits on one eligible face. Only split/reflow
    // when the requested matrix physically cannot fit on one face.
    if(form.array.layoutMode!=="automatic" && form.array.rows*form.array.columns===count){
      const ordered=form.roofSelection?.mode==="priority"
        ? [...faces].sort((a,b)=>a.id===form.roofSelection?.priorityFaceId?-1:b.id===form.roofSelection?.priorityFaceId?1:0)
        : faces;
      for(const face of ordered){
        const fit=checkSingleRoofPlaneFit({...form,roofGeometry:face,requestedPanelCount:undefined});
        if(fit.calibrated&&fit.fits&&(face.blockedCells??0)===0){
          const field=computePVField(form.panel,form.array);
          const placement:FacePlacement={
            faceId:face.id,
            label:face.label,
            panelCount:count,
            rows:form.array.rows,
            columns:form.array.columns,
            lastRowCount:form.array.columns,
            resolvedGutterMm:fit.gutterMm??preferred,
            resolvedRidgeMm:fit.ridgeMm,
            resolvedLeftMm:fit.leftMm,
            resolvedRightMm:fit.rightMm,
            widthMm:face.widthMm,
            slopeLengthMm:face.slopeLengthMm,
          };
          return{count,placements:[placement],primaryFieldWidthMm:field.fieldWidthMm,primaryFieldHeightMm:field.fieldHeightMm,split:false};
        }
      }
    }
    const allocation=allocateAcrossRoofFaces({
      panel:form.panel,totalPanels:count,orientation:form.array.orientation,
      faces:faces.map(f=>({id:f.id,label:f.label,widthMm:f.widthMm,slopeLengthMm:f.slopeLengthMm,blockedCells:f.blockedCells})),
      mode:form.roofSelection?.mode??"automatic",priorityFaceId:form.roofSelection?.priorityFaceId,
      gapMm:gap,preferredGutterMm:preferred,minimumRidgeMm:ridgeMinimum,
    });
    if(!allocation.fits) throw new Error(allocation.reasons.join(" "));
    const placements:FacePlacement[]=allocation.allocations.map(a=>{
      const f=faces.find(x=>x.id===a.faceId)!;
      const panelW=form.array.orientation==="portrait"?form.panel.widthMm:form.panel.heightMm;
      const rowWidth=a.columns*panelW+Math.max(0,a.columns-1)*gap;
      const lateral=lateralClearances(form,f.widthMm,rowWidth);
      return {
        faceId:a.faceId,
        label:f.label,
        panelCount:a.panelCount,
        rows:a.rows,
        columns:a.columns,
        lastRowCount:a.lastRowCount,
        resolvedGutterMm:a.resolvedGutterMm,
        resolvedRidgeMm:a.resolvedRidgeMm,
        resolvedLeftMm:lateral.leftMm,
        resolvedRightMm:lateral.rightMm,
        widthMm:f.widthMm,
        slopeLengthMm:f.slopeLengthMm,
      };
    });
    const p=placements[0]!;
    const pw=form.array.orientation==="portrait"?form.panel.widthMm:form.panel.heightMm;
    const ph=form.array.orientation==="portrait"?form.panel.heightMm:form.panel.widthMm;
    const primaryFieldWidthMm=p.columns*pw+Math.max(0,p.columns-1)*gap;
    const primaryFieldHeightMm=p.rows*ph+Math.max(0,p.rows-1)*gap;
    return {count,placements,primaryFieldWidthMm,primaryFieldHeightMm,split:placements.length>1};
  }

  // Backward-compatible single-face mode. If the user explicitly requested a fixed matrix,
  // its multiplication must match the requested quantity.
  if(form.array.layoutMode!=="automatic" && form.array.rows*form.array.columns!==count){
    throw new Error(`Fixed layout ${form.array.rows}×${form.array.columns} does not equal requested quantity ${count}.`);
  }
  const fit=checkSingleRoofPlaneFit({...form,requestedPanelCount:undefined});
  if(fit.calibrated&&!fit.fits) throw new Error(fit.reasons.join(" "));
  const field=computePVField(form.panel,form.array);
  return {
    count,
    placements:[{
      faceId:form.array.roofFace||"A",
      label:form.array.roofFace||"Pan A",
      panelCount:count,
      rows:form.array.rows,
      columns:form.array.columns,
      lastRowCount:form.array.columns,
      resolvedGutterMm:fit.gutterMm??preferred,
      resolvedRidgeMm:fit.ridgeMm,
      resolvedLeftMm:fit.leftMm,
      resolvedRightMm:fit.rightMm,
      widthMm:form.roofGeometry?.widthMm??field.fieldWidthMm,
      slopeLengthMm:form.roofGeometry?.slopeLengthMm??field.fieldHeightMm,
    }],
    primaryFieldWidthMm:field.fieldWidthMm,
    primaryFieldHeightMm:field.fieldHeightMm,
    split:false,
  };
}

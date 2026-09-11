import type { VisionAnalyzer } from "./interfaces";
import type { InputPhoto, MetricPoint2D, Point2D, ProjectContext, ProjectForm, RoofFaceMetricGeometry, RoofFaceObservation, RoofViewObservation } from "../types";
import { multiFaceConstraintFacts } from "../geometry/pvConstraints";
import { resolveProjectLayout } from "../geometry/projectLayout";
import { projectAnalysisPrompt } from "../prompts/projectAnalysis";
import { toDataUrl } from "../utils/dataUrl";
import { openaiJson } from "./openaiJson";
import { supportRules } from "../geometry/supportRules";
import { gateAllocatedSurfaces, selectLayoutEligibleSurfaces } from "../geometry/surfaceSupport";

const roles=["satellite","satellite_mass","front","left_oblique","right_oblique","near","roof","far"] as const;
const pointSchema={type:"object",additionalProperties:false,properties:{x:{type:"number"},y:{type:"number"}},required:["x","y"]} as const;
const lineSchema={type:["array","null"],minItems:2,maxItems:2,items:pointSchema} as const;
const viewSchema={type:"object",additionalProperties:false,properties:{
  role:{type:"string",enum:roles},selectedFaceVisible:{type:"boolean"},confidence:{type:"number",minimum:0,maximum:1},
  roofPolygonNormalized:{type:"array",items:pointSchema},gutterLineNormalized:lineSchema,ridgeLineNormalized:lineSchema,perspectiveNotes:{type:"array",items:{type:"string"}}
},required:["role","selectedFaceVisible","confidence","roofPolygonNormalized","gutterLineNormalized","ridgeLineNormalized","perspectiveNotes"]} as const;
const obstacleSchema={type:"object",additionalProperties:false,properties:{type:{type:"string"},description:{type:"string"},polygonNormalized:{type:["array","null"],items:pointSchema},viewRole:{type:["string","null"],enum:[...roles,null]}},required:["type","description","polygonNormalized","viewRole"]} as const;
const faceSchema={type:"object",additionalProperties:false,properties:{
  id:{type:"string"},label:{type:"string"},orientation:{type:["string","null"]},confidence:{type:"number",minimum:0,maximum:1},slopeDeg:{type:["number","null"],minimum:0,maximum:90},
  views:{type:"array",items:viewSchema},obstacles:{type:"array",items:obstacleSchema}
},required:["id","label","orientation","confidence","slopeDeg","views","obstacles"]} as const;
const schema={type:"object",additionalProperties:false,properties:{faces:{type:"array",minItems:1,items:faceSchema},perspectiveNotes:{type:"array",items:{type:"string"}},uncertainties:{type:"array",items:{type:"string"}}},required:["faces","perspectiveNotes","uncertainties"]} as const;

type RawView={
  role:RoofViewObservation["role"];
  selectedFaceVisible:boolean;
  confidence:number;
  roofPolygonNormalized:Point2D[];
  gutterLineNormalized:[Point2D,Point2D]|null;
  ridgeLineNormalized:[Point2D,Point2D]|null;
  perspectiveNotes:string[];
};
type RawObstacle={
  type:string;
  description:string;
  polygonNormalized:Point2D[]|null;
  viewRole:RoofViewObservation["role"]|null;
};
type RawFace={
  id:string;
  label:string;
  orientation:string|null;
  confidence:number;
  slopeDeg:number|null;
  views:RawView[];
  obstacles:RawObstacle[];
};
type Raw={faces:RawFace[];perspectiveNotes:string[];uncertainties:string[]};

function cleanView(v:RawView,faceId:string):RoofViewObservation {
  return {...v,faceId,gutterLineNormalized:v.gutterLineNormalized??undefined,ridgeLineNormalized:v.ridgeLineNormalized??undefined};
}
function rawFaces(raw:Raw):RoofFaceObservation[]{
  return (raw.faces??[]).map(f=>({
    id:String(f.id),label:String(f.label),orientation:f.orientation??undefined,confidence:Number(f.confidence),slopeDeg:f.slopeDeg??undefined,
    views:(f.views??[]).map(v=>cleanView(v,String(f.id))),
    obstacles:(f.obstacles??[]).map(o=>({...o,polygonNormalized:o.polygonNormalized??undefined,viewRole:o.viewRole??undefined})),
  }));
}

function distancePx(a:{x:number;y:number},b:{x:number;y:number},width:number,height:number){return Math.hypot((b.x-a.x)*width,(b.y-a.y)*height);}
function polygonArea(poly:Array<{x:number;y:number}>){let a=0;for(let i=0,j=poly.length-1;i<poly.length;j=i++)a+=poly[j]!.x*poly[i]!.y-poly[i]!.x*poly[j]!.y;return Math.abs(a)/2;}
function normalizedToPixels(point:Point2D,width:number,height:number){return {x:point.x*width,y:point.y*height};}
function validPoint(point:Point2D|undefined):point is Point2D{return Boolean(point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=-.05&&point.x<=1.05&&point.y>=-.05&&point.y<=1.05);}
function validLine(line:[Point2D,Point2D]|undefined):line is [Point2D,Point2D]{return Boolean(line&&validPoint(line[0])&&validPoint(line[1])&&Math.hypot(line[1].x-line[0].x,line[1].y-line[0].y)>1e-4);}
function pointDistance(a:Point2D,b:Point2D){return Math.hypot(a.x-b.x,a.y-b.y);}

function orientedBoxFromPolygon(points:Point2D[],baseLine?:[Point2D,Point2D]):[Point2D,Point2D,Point2D,Point2D]|undefined{
  const clean=points.filter(validPoint);
  if(clean.length<3)return undefined;
  let p0:Point2D,p1:Point2D;
  if(validLine(baseLine)){[p0,p1]=baseLine;}else{
    let best=-1;let edge:[Point2D,Point2D]|undefined;
    for(let i=0;i<clean.length;i++){
      const a=clean[i]!,b=clean[(i+1)%clean.length]!;const d=pointDistance(a,b);
      if(d>best){best=d;edge=[a,b];}
    }
    if(!edge)return undefined;[p0,p1]=edge;
  }
  const dx=p1.x-p0.x,dy=p1.y-p0.y,len=Math.hypot(dx,dy);
  if(len<1e-5)return undefined;
  const ex=dx/len,ey=dy/len;let nx=-ey,ny=ex;
  const mid={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2};
  const centroid={x:clean.reduce((s,p)=>s+p.x,0)/clean.length,y:clean.reduce((s,p)=>s+p.y,0)/clean.length};
  if((centroid.x-mid.x)*nx+(centroid.y-mid.y)*ny<0){nx*=-1;ny*=-1;}
  const s=(p:Point2D)=>p.x*ex+p.y*ey,t=(p:Point2D)=>p.x*nx+p.y*ny;
  const baseT=validLine(baseLine)?(t(p0)+t(p1))/2:Math.min(...clean.map(t));
  const farT=Math.max(...clean.map(t));
  const span=farT-baseT;
  if(span<1e-4)return undefined;
  const upper=clean.filter(p=>t(p)>=baseT+span*.55);
  const lowerS=validLine(baseLine)?[s(p0),s(p1)]:clean.map(s);
  const upperS=upper.length>=2?upper.map(s):clean.map(s);
  const lsMin=Math.min(...lowerS),lsMax=Math.max(...lowerS),usMin=Math.min(...upperS),usMax=Math.max(...upperS);
  const from=(sv:number,tv:number):Point2D=>({x:sv*ex+tv*nx,y:sv*ey+tv*ny});
  return [from(lsMin,baseT),from(lsMax,baseT),from(usMax,farT),from(usMin,farT)];
}

/**
 * Normalize a roof-face observation into the four ordered anchors required by the
 * metric/layout engine. This is deliberately generic: it accepts exact quads,
 * gutter+ridge line evidence, or a richer polygon that can be reduced safely.
 */
export function canonicalizeRoofFaceQuad(view:Pick<RoofViewObservation,"roofPolygonNormalized"|"gutterLineNormalized"|"ridgeLineNormalized">):[Point2D,Point2D,Point2D,Point2D]|undefined{
  const polygon=(view.roofPolygonNormalized??[]).filter(validPoint);
  const gutter=validLine(view.gutterLineNormalized)?view.gutterLineNormalized:undefined;
  const ridge=validLine(view.ridgeLineNormalized)?view.ridgeLineNormalized:undefined;

  if(gutter&&ridge){
    const [g0,g1]=gutter,[r0,r1]=ridge;
    const direct=pointDistance(g0,r0)+pointDistance(g1,r1);
    const crossed=pointDistance(g0,r1)+pointDistance(g1,r0);
    const quad:[Point2D,Point2D,Point2D,Point2D]=direct<=crossed?[g0,g1,r1,r0]:[g0,g1,r0,r1];
    if(polygonArea(quad)>1e-6)return quad;
  }
  if(polygon.length===4&&polygonArea(polygon)>1e-6)return polygon as [Point2D,Point2D,Point2D,Point2D];
  const recovered=orientedBoxFromPolygon(polygon,gutter);
  return recovered&&polygonArea(recovered)>1e-6?recovered:undefined;
}

function resolvedPhysicalPlacement(
  placement: NonNullable<ProjectContext["facePlacements"]>[number],
  metric: RoofFaceMetricGeometry | undefined,
): ProjectContext["resolvedPlacement"] {
  if (!metric?.widthMm || !metric.slopeLengthMm) return undefined;
  const modules = placement.modulePlacementsMm;
  if (modules?.length === placement.panelCount) {
    const points = modules.flatMap((module) => module.polygonMm);
    if (points.length && points.every((point) => Number.isFinite(point.xMm) && Number.isFinite(point.yMm))) {
      const minX = Math.min(...points.map((point) => point.xMm));
      const maxX = Math.max(...points.map((point) => point.xMm));
      const minY = Math.min(...points.map((point) => point.yMm));
      const maxY = Math.max(...points.map((point) => point.yMm));
      return {
        leftMm: Math.max(0, minX),
        rightMm: Math.max(0, metric.widthMm - maxX),
        gutterMm: Math.max(0, minY),
        ridgeMm: Math.max(0, metric.slopeLengthMm - maxY),
      };
    }
  }
  return {
    leftMm: Math.max(0, placement.resolvedLeftMm ?? 0),
    rightMm: Math.max(0, placement.resolvedRightMm ?? 0),
    gutterMm: Math.max(0, placement.resolvedGutterMm),
    ridgeMm: Math.max(0, placement.resolvedRidgeMm ?? 0),
  };
}

function metricBasis(
  quad:[Point2D,Point2D,Point2D,Point2D],
  widthPx:number,
  heightPx:number,
  metersPerPixel:number,
  slopeDeg:number,
){
  const [bl,br,tr,tl]=quad.map((point)=>normalizedToPixels(point,widthPx,heightPx)) as [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}];
  const dx=br.x-bl.x,dy=br.y-bl.y;
  const eaveLength=Math.hypot(dx,dy);
  if(eaveLength<1e-6)throw new Error("IGN roof-face low edge is degenerate.");
  const ex=dx/eaveLength,ey=dy/eaveLength;
  let nx=-ey,ny=ex;
  const lowerMid={x:(bl.x+br.x)/2,y:(bl.y+br.y)/2};
  const upperMid={x:(tl.x+tr.x)/2,y:(tl.y+tr.y)/2};
  if((upperMid.x-lowerMid.x)*nx+(upperMid.y-lowerMid.y)*ny<0){nx*=-1;ny*=-1;}
  const mmPerPixel=metersPerPixel*1000;
  const cosSlope=Math.max(.26,Math.cos(slopeDeg*Math.PI/180));
  return {
    toMetric(point:Point2D):MetricPoint2D{
      const p=normalizedToPixels(point,widthPx,heightPx);
      const vx=p.x-bl.x,vy=p.y-bl.y;
      return {xMm:(vx*ex+vy*ey)*mmPerPixel,yMm:((vx*nx+vy*ny)*mmPerPixel)/cosSlope};
    },
  };
}

export function deriveMetricRoofFaces(form:ProjectForm,photos:InputPhoto[],faces:RoofFaceObservation[]):RoofFaceMetricGeometry[]{
  if((form.roofFaces?.length??0)>0)return form.roofFaces!;
  const sat=photos.find(p=>p.role==="satellite_mass");
  if(!sat?.metersPerPixel||!sat.widthPx||!sat.heightPx)throw new Error("Official IGN close-view metric scale and pixel dimensions are required to derive roof-face capacity.");
  const mpp=sat.metersPerPixel;const out:RoofFaceMetricGeometry[]=[];
  for(const face of faces){
    const view=face.views.find(v=>v.role==="satellite_mass"&&v.selectedFaceVisible&&canonicalizeRoofFaceQuad(v));
    if(!view)continue;
    const quad=canonicalizeRoofFaceQuad(view);if(!quad)continue;
    const [bl,br,tr,tl]=quad;
    const eave=distancePx(bl,br,sat.widthPx,sat.heightPx),ridge=distancePx(tl,tr,sat.widthPx,sat.heightPx);
    const left=distancePx(bl,tl,sat.widthPx,sat.heightPx),right=distancePx(br,tr,sat.widthPx,sat.heightPx);
    const widthGround=Math.min(eave,ridge)*mpp,runGround=((left+right)/2)*mpp;
    if(!(widthGround>.4&&runGround>.4))continue;
    const slope=Math.max(0,Math.min(75,Number(form.roofGeometry?.slopeDeg??face.slopeDeg??0)));
    const slopeLength=runGround/Math.max(.26,Math.cos(slope*Math.PI/180));
    const sourcePolygon=view.roofPolygonNormalized.length>=3?view.roofPolygonNormalized:quad;
    const faceArea=Math.max(1e-8,polygonArea(sourcePolygon));
    const relevantObstacles=face.obstacles.filter(o=>!o.viewRole||o.viewRole==="satellite_mass");
    const obsArea=relevantObstacles.reduce((sum,o)=>sum+(o.polygonNormalized?.length?polygonArea(o.polygonNormalized):0),0);
    const panelW=form.array.orientation==="portrait"?form.panel.widthMm:form.panel.heightMm,panelH=form.array.orientation==="portrait"?form.panel.heightMm:form.panel.widthMm,gap=form.array.interPanelGapMm??20;
    const gross=Math.max(0,Math.floor((widthGround*1000+gap)/(panelW+gap)))*Math.max(0,Math.floor((slopeLength*1000+gap)/(panelH+gap)));
    const blockedCells=obsArea>0?Math.min(gross,Math.ceil(gross*Math.min(.9,(obsArea/faceArea)*1.5))):0;
    const basis=metricBasis(quad,sat.widthPx,sat.heightPx,mpp,slope);
    const surfacePolygonMm=quad.map(basis.toMetric);
    const obstaclePolygonsMm=relevantObstacles.flatMap((obstacle)=>{
      const polygon=obstacle.polygonNormalized;
      if(!polygon||polygon.length<3||!polygon.every(validPoint))return [];
      return [{type:obstacle.type,description:obstacle.description,polygonMm:polygon.map(basis.toMetric)}];
    });
    out.push({id:face.id,label:face.label,widthMm:Math.floor(widthGround*1000),slopeLengthMm:Math.floor(slopeLength*1000),slopeDeg:slope,surfacePolygonMm,obstaclePolygonsMm,blockedCells,source:"ign-derived"});
  }
  return out;
}

function imageLabel(photo:InputPhoto,index:number){
  const scale=photo.metersPerPixel?` Metric scale supplied by host: ${photo.metersPerPixel} metre/pixel.`:"";
  return `IMAGE ${index+1} — AUTHORITATIVE ROLE = "${photo.role}". In structured output, observations from this exact image MUST use role "${photo.role}".${scale}`;
}

export class OpenAIVisionAnalyzer implements VisionAnalyzer {
  constructor(
    private apiKey:string,
    private model="gpt-5.6-sol",
    private minUserPhotos=3,
  ){}

  private async inspect(form:ProjectForm,photos:InputPhoto[],recovery=false):Promise<Raw>{
    const inventory=photos.map((photo,index)=>`- Image ${index+1}: role=${photo.role}${photo.metersPerPixel?`, scale=${photo.metersPerPixel} m/px`:""}`).join("\n");
    const recoveryInstruction=recovery?`\nAUTOMATIC METRIC RECOVERY PASS:\nThe normal pass did not yield a usable metric roof face. Image 1 is the official close orthographic IGN view and MUST be returned with role satellite_mass. Use the user roof photograph only to understand which physical slope/face corresponds to the requested support. For every roof face visible in image 1, return its satellite_mass polygon. Prefer exact gutter and ridge lines. A polygon may contain more than four points; do not omit the face just because its outline is not a perfect quadrilateral. Never invent a dimension.`:"";
    const prompt=`${projectAnalysisPrompt(form)}\n\nAUTHORITATIVE IMAGE INVENTORY:\n${inventory}\nThe role labels above come from PilotPaper and are not to be inferred or renamed. Return each observation under the exact role of the image it came from.${recoveryInstruction}`;
    return openaiJson<Raw>({
      apiKey:this.apiKey,
      model:this.model,
      prompt,
      imageDataUrls:photos.map(toDataUrl),
      imageLabels:photos.map(imageLabel),
      schemaName:recovery?"dp_roof_faces_metric_recovery":"dp_roof_faces_analysis",
      schema:schema as unknown as Record<string,unknown>,
    });
  }

  async analyze(form:ProjectForm,photos:InputPhoto[]):Promise<ProjectContext>{
    const userPhotos=photos.filter(p=>!["satellite","satellite_mass"].includes(p.role));
    if(userPhotos.length<this.minUserPhotos) throw new Error(`At least ${this.minUserPhotos} independent user photograph(s) are required.`);

    let raw=await this.inspect(form,photos,false);
    let faces=rawFaces(raw);
    if(!faces.length)throw new Error("No usable roof/support plane could be demonstrated from the supplied evidence.");

    let metricFaces=deriveMetricRoofFaces(form,photos,faces);
    if(!metricFaces.length){
      const satMass=photos.find(photo=>photo.role==="satellite_mass");
      const roof=userPhotos.find(photo=>photo.role==="roof")??userPhotos[0];
      if(satMass&&roof){
        const recoveryPhotos=[satMass,roof];
        const recoveredRaw=await this.inspect(form,recoveryPhotos,true);
        const recoveredFaces=rawFaces(recoveredRaw);
        const recoveredMetric=deriveMetricRoofFaces(form,recoveryPhotos,recoveredFaces);
        if(recoveredMetric.length){raw=recoveredRaw;faces=recoveredFaces;metricFaces=recoveredMetric;}
      }
    }
    if(!metricFaces.length)throw new Error("PilotPaper could not automatically reconstruct a metric roof/support face from the official IGN close view and the supplied roof evidence.");

    const topology=form.support?.topology??"unknown";
    const eligibility=selectLayoutEligibleSurfaces(faces,topology);
    const eligibleMetricFaces=metricFaces.filter((face)=>eligibility.eligibleFaceIds.includes(face.id));
    if(form.roofSelection?.mode==="priority"&&form.roofSelection.priorityFaceId&&eligibility.rejected[form.roofSelection.priorityFaceId]){
      throw new Error(`Priority surface ${form.roofSelection.priorityFaceId} failed the V1 understanding gate: ${eligibility.rejected[form.roofSelection.priorityFaceId]!.join(" ")}`);
    }
    if(!eligibleMetricFaces.length){
      const details=Object.entries(eligibility.rejected).map(([faceId,reasons])=>`${faceId}: ${reasons.join(" ")}`).join(" ");
      throw new Error(`No roof/support surface is safe enough for photovoltaic layout.${details?` ${details}`:""}`);
    }

    const resolvedForm:ProjectForm={...form,roofFaces:eligibleMetricFaces};
    const layout=resolveProjectLayout(resolvedForm);
    const primaryPlacement=layout.placements[0]!;
    const primaryFace=faces.find(f=>f.id===primaryPlacement.faceId)??faces[0]!;
    const primaryView=primaryFace.views.find(v=>v.selectedFaceVisible&&v.roofPolygonNormalized.length>=3);
    if(!primaryView)throw new Error(`Allocated face ${primaryPlacement.faceId} is not visibly demonstrated in the supplied photographs.`);

    const understandingGate=gateAllocatedSurfaces(faces,topology,layout.placements.map((placement)=>placement.faceId));
    const primaryMetric=eligibleMetricFaces.find(f=>f.id===primaryPlacement.faceId)??form.roofGeometry;
    const resolvedPlacement=resolvedPhysicalPlacement(primaryPlacement,primaryMetric);
    const flattened=faces.flatMap(f=>f.views);
    const allObstacles=primaryFace.obstacles.map(o=>({type:o.type,description:o.description,polygonNormalized:o.polygonNormalized}));
    const rules=supportRules(topology,form.support?.covering??"unknown");
    const excludedSurfaceWarnings=Object.keys(eligibility.rejected).map((faceId)=>`Surface ${faceId} was excluded before PV layout because its geometry/evidence did not pass the V1 gate.`);
    const uncertainties=[...(raw.uncertainties??[]),...eligibility.warnings,...understandingGate.warnings,...excludedSurfaceWarnings];
    return {
      projectId:form.projectId,address:form.address,array:form.array,panel:form.panel,exactPanelCount:layout.count,
      fieldWidthMm:layout.primaryFieldWidthMm,fieldHeightMm:layout.primaryFieldHeightMm,roofGeometry:primaryMetric,
      resolvedPlacement,facePlacements:layout.placements,support:form.support,
      roof:{selectedFaceDescription:primaryFace.label,confidence:understandingGate.confidence,roofPolygonNormalized:primaryView.roofPolygonNormalized,gutterLineNormalized:primaryView.gutterLineNormalized,ridgeLineNormalized:primaryView.ridgeLineNormalized,views:flattened,faces,obstacles:allObstacles,perspectiveNotes:raw.perspectiveNotes??[],uncertainties},
      immutableFacts:[...multiFaceConstraintFacts(resolvedForm,layout.placements),...rules.visualWarnings]
    };
  }
}

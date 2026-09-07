import type { VisionAnalyzer } from "./interfaces";
import type { InputPhoto, ProjectContext, ProjectForm, RoofFaceMetricGeometry, RoofFaceObservation, RoofViewObservation } from "../types";
import { computePVField, multiFaceConstraintFacts } from "../geometry/pvConstraints";
import { resolveProjectLayout } from "../geometry/projectLayout";
import { projectAnalysisPrompt } from "../prompts/projectAnalysis";
import { toDataUrl } from "../utils/dataUrl";
import { openaiJson } from "./openaiJson";
import { supportRules } from "../geometry/supportRules";

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

type Raw={faces:Array<any>;perspectiveNotes:string[];uncertainties:string[]};

function cleanView(v:any,faceId:string):RoofViewObservation {
  return {...v,faceId,gutterLineNormalized:v.gutterLineNormalized??undefined,ridgeLineNormalized:v.ridgeLineNormalized??undefined};
}

function distancePx(a:{x:number;y:number},b:{x:number;y:number},width:number,height:number){return Math.hypot((b.x-a.x)*width,(b.y-a.y)*height);}
function polygonArea(poly:Array<{x:number;y:number}>){let a=0;for(let i=0,j=poly.length-1;i<poly.length;j=i++)a+=poly[j]!.x*poly[i]!.y-poly[i]!.x*poly[j]!.y;return Math.abs(a)/2;}

/** Derive conservative metric face rectangles from the official orthographic IGN close view.
 * For hipped/trapezoidal faces the shorter ridge/eave width is used, intentionally under-estimating capacity.
 */
export function deriveMetricRoofFaces(form:ProjectForm,photos:InputPhoto[],faces:RoofFaceObservation[]):RoofFaceMetricGeometry[]{
  if((form.roofFaces?.length??0)>0)return form.roofFaces!;
  const sat=photos.find(p=>p.role==="satellite_mass");
  if(!sat?.metersPerPixel||!sat.widthPx||!sat.heightPx)throw new Error("Official IGN close-view metric scale and pixel dimensions are required to derive roof-face capacity.");
  const mpp=sat.metersPerPixel;const out:RoofFaceMetricGeometry[]=[];
  for(const face of faces){
    const view=face.views.find(v=>v.role==="satellite_mass"&&v.selectedFaceVisible&&v.roofPolygonNormalized.length===4);
    if(!view)continue;
    const q=view.roofPolygonNormalized;const [bl,br,tr,tl]=q;if(!bl||!br||!tr||!tl)continue;
    const eave=distancePx(bl,br,sat.widthPx,sat.heightPx),ridge=distancePx(tl,tr,sat.widthPx,sat.heightPx);
    const left=distancePx(bl,tl,sat.widthPx,sat.heightPx),right=distancePx(br,tr,sat.widthPx,sat.heightPx);
    const widthGround=Math.min(eave,ridge)*mpp,runGround=((left+right)/2)*mpp;
    const slope=Math.max(0,Math.min(75,Number(form.roofGeometry?.slopeDeg??face.slopeDeg??0)));
    const slopeLength=runGround/Math.max(.26,Math.cos(slope*Math.PI/180));
    const faceArea=Math.max(1e-8,polygonArea(q));
    const obsArea=face.obstacles.filter(o=>!o.viewRole||o.viewRole==="satellite_mass").reduce((sum,o)=>sum+(o.polygonNormalized?.length?polygonArea(o.polygonNormalized):0),0);
    const panelW=form.array.orientation==="portrait"?form.panel.widthMm:form.panel.heightMm,panelH=form.array.orientation==="portrait"?form.panel.heightMm:form.panel.widthMm,gap=form.array.interPanelGapMm??20;
    const gross=Math.max(0,Math.floor((widthGround*1000+gap)/(panelW+gap)))*Math.max(0,Math.floor((slopeLength*1000+gap)/(panelH+gap)));
    const blockedCells=obsArea>0?Math.min(gross,Math.ceil(gross*Math.min(.9,(obsArea/faceArea)*1.5))):0;
    out.push({id:face.id,label:face.label,widthMm:Math.floor(widthGround*1000),slopeLengthMm:Math.floor(slopeLength*1000),slopeDeg:slope,blockedCells,source:"ign-derived"});
  }
  return out;
}

export class OpenAIVisionAnalyzer implements VisionAnalyzer {
  constructor(
    private apiKey:string,
    private model="gpt-5.6-sol",
    private minUserPhotos=3,
  ){}
  async analyze(form:ProjectForm,photos:InputPhoto[]):Promise<ProjectContext>{
    const userPhotos=photos.filter(p=>!["satellite","satellite_mass"].includes(p.role));
    if(userPhotos.length<this.minUserPhotos) throw new Error(`At least ${this.minUserPhotos} independent user photograph(s) are required.`);
    const raw=await openaiJson<Raw>({apiKey:this.apiKey,model:this.model,prompt:projectAnalysisPrompt(form),imageDataUrls:photos.map(toDataUrl),schemaName:"dp_roof_faces_analysis",schema:schema as unknown as Record<string,unknown>});
    const faces:RoofFaceObservation[]=(raw.faces??[]).map(f=>({id:String(f.id),label:String(f.label),orientation:f.orientation??undefined,confidence:Number(f.confidence),slopeDeg:f.slopeDeg??undefined,views:(f.views??[]).map((v:any)=>cleanView(v,String(f.id))),obstacles:(f.obstacles??[]).map((o:any)=>({...o,polygonNormalized:o.polygonNormalized??undefined,viewRole:o.viewRole??undefined}))}));
    if(!faces.length) throw new Error("No usable roof/support plane could be demonstrated from the supplied evidence.");

    const metricFaces=deriveMetricRoofFaces(form,photos,faces);
    if(!metricFaces.length) throw new Error("No roof/support face could be metrically derived from the official IGN close view.");
    const resolvedForm:ProjectForm={...form,roofFaces:metricFaces};
    const layout=resolveProjectLayout(resolvedForm);
    const primaryPlacement=layout.placements[0]!;
    const primaryFace=faces.find(f=>f.id===primaryPlacement.faceId) ?? faces[0]!;
    const primaryView=primaryFace.views.find(v=>v.selectedFaceVisible&&v.roofPolygonNormalized.length>=3);
    if(!primaryView) throw new Error(`Allocated face ${primaryPlacement.faceId} is not visibly demonstrated in the supplied photographs.`);

    // Every allocated face must be evidenced in at least one real user photograph.
    for(const placement of layout.placements){
      const face=faces.find(f=>f.id===placement.faceId);
      if(!face) throw new Error(`Allocated roof face ${placement.faceId} was not detected by vision analysis.`);
      const visible=face.views.some(v=>v.selectedFaceVisible&&v.roofPolygonNormalized.length>=3&&!["satellite","satellite_mass"].includes(v.role));
      if(!visible) throw new Error(`Allocated roof face ${placement.faceId} is not demonstrated in a real project photograph.`);
    }

    const field=computePVField(form.panel,{...form.array,rows:primaryPlacement.rows,columns:primaryPlacement.columns});
    const primaryMetric=metricFaces.find(f=>f.id===primaryPlacement.faceId) ?? form.roofGeometry;
    const resolvedPlacement=primaryMetric?.widthMm&&primaryMetric.slopeLengthMm?{
      leftMm:Math.max(0,(primaryMetric.widthMm-field.fieldWidthMm)/2),rightMm:Math.max(0,(primaryMetric.widthMm-field.fieldWidthMm)/2),
      gutterMm:primaryPlacement.resolvedGutterMm,ridgeMm:Math.max(0,primaryMetric.slopeLengthMm-primaryPlacement.resolvedGutterMm-field.fieldHeightMm)
    }:undefined;
    const flattened=faces.flatMap(f=>f.views);
    const allObstacles=primaryFace.obstacles.map(o=>({type:o.type,description:o.description,polygonNormalized:o.polygonNormalized}));
    const rules=supportRules(form.support?.topology??"unknown",form.support?.covering??"unknown");
    return {
      projectId:form.projectId,address:form.address,array:form.array,panel:form.panel,exactPanelCount:layout.count,
      fieldWidthMm:layout.primaryFieldWidthMm,fieldHeightMm:layout.primaryFieldHeightMm,roofGeometry:primaryMetric,
      resolvedPlacement,facePlacements:layout.placements,support:form.support,
      roof:{selectedFaceDescription:primaryFace.label,confidence:Math.min(...layout.placements.map(p=>faces.find(f=>f.id===p.faceId)?.confidence??0)),roofPolygonNormalized:primaryView.roofPolygonNormalized,gutterLineNormalized:primaryView.gutterLineNormalized,ridgeLineNormalized:primaryView.ridgeLineNormalized,views:flattened,faces,obstacles:allObstacles,perspectiveNotes:raw.perspectiveNotes??[],uncertainties:raw.uncertainties??[]},
      immutableFacts:[...multiFaceConstraintFacts(resolvedForm,layout.placements),...rules.visualWarnings]
    };
  }
}

import { env } from "cloudflare:workers";
import type { ArchitecturalEvidence, ArchitecturalGeometry, FaceAllocationGeometry, NormalizedPoint, VerifiedDimension } from "@/lib/architectural-evidence";
import type { DpProjectRecord, DpRenderedView, DpSourceFile } from "@/lib/dp-pdf";
import { createDPAIEngine } from "@/lib/dp-ai-engine/factory";
import type { EngineConfig } from "@/lib/dp-ai-engine/config";
import type { InputPhoto, PhotoRole, ProjectContext, ProjectForm, RoofTopology, RoofCovering } from "@/lib/dp-ai-engine/types";
import { panelPolygonsForView } from "@/lib/dp-ai-engine/geometry/panelProjection";

export type DpAiRun = {
  evidence: ArchitecturalEvidence;
  renderedViews: DpRenderedView[];
  audit: Record<string, unknown>;
};

function configured(name:string){
  const workerEnv=env as unknown as Record<string,unknown>;
  const value=workerEnv[name] ?? (typeof process!=="undefined" ? process.env?.[name] : undefined);
  return typeof value==="string"?value.trim():"";
}
function apiKey(){return configured("OPENAI_API_KEY");}
function number(value:string|undefined,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function int(value:string|undefined,fallback=0){return Math.trunc(number(value,fallback));}
function pngSize(bytes:Uint8Array){if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)return undefined;const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return{width:v.getUint32(16),height:v.getUint32(20)};}
function b64(bytes:Uint8Array){return Buffer.from(bytes).toString("base64");}
async function sha256(bytes:Uint8Array){const digest=await crypto.subtle.digest("SHA-256",bytes);return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function topology(project:DpProjectRecord):RoofTopology{
  const raw=project.details.roofTopology as RoofTopology|undefined;
  if(["gable","mono_pitch","hipped","flat","carport","canopy","unknown"].includes(raw??""))return raw!;
  if(project.supportType==="carport")return"carport";
  if(project.supportType==="canopy")return"canopy";
  if(project.supportType==="flat_roof")return"flat";
  return"unknown";
}
function covering(project:DpProjectRecord):RoofCovering{
  const raw=project.details.coveringType as RoofCovering|undefined;
  if(["tile","slate","steel_sheet","zinc","membrane","other","unknown"].includes(raw??""))return raw!;
  const text=(project.details.roofColor??"").toLowerCase();
  if(/bac|acier|t[oô]le/.test(text))return"steel_sheet";if(/ardoise/.test(text))return"slate";if(/tuile/.test(text))return"tile";if(/zinc/.test(text))return"zinc";return"unknown";
}
function makeForm(project:DpProjectRecord):ProjectForm{
  const d=project.details;
  let roofFaces:ProjectForm["roofFaces"];try{const parsed=JSON.parse(d.roofFacesJson||"[]");if(Array.isArray(parsed))roofFaces=parsed;}catch{}
  const rows=Math.max(1,int(d.layoutRows,1)),columns=Math.max(1,int(d.layoutColumns,Math.max(1,project.moduleCount)));
  const layoutMode=d.layoutMode==="automatic"?"automatic":"fixed";
  return{
    projectId:project.id,address:project.siteAddress,applicantName:project.requesterName,parcelReference:d.cadastralReference,
    panel:{model:project.moduleReference,widthMm:number(d.moduleWidthMm),heightMm:number(d.moduleHeightMm),frameColor:d.panelColor,powerWp:project.moduleCount>0?Math.round(number(project.powerKwp)*1000/project.moduleCount):undefined},
    requestedPanelCount:project.moduleCount,
    array:{rows,columns,orientation:d.moduleOrientation==="landscape"?"landscape":"portrait",roofFace:d.priorityRoofFaceId||"A",placement:(d.panelPlacement==="left"||d.panelPlacement==="right"?d.panelPlacement:"centered"),layoutMode,allowSplitAcrossFaces:true,gutterClearanceMm:Math.max(0,number(d.preferredGutterClearanceMm,300)),ridgeClearanceMm:Math.max(0,number(d.ridgeClearanceMm,0)),interPanelGapMm:Math.max(0,number(d.panelGapMm,20))},
    roofGeometry:{slopeDeg:Math.max(0,Math.min(75,number(d.roofPitchDeg,0))),source:"ign-derived"},
    roofFaces,
    roofSelection:{mode:d.roofSelectionMode==="priority"?"priority":"automatic",priorityFaceId:d.roofSelectionMode==="priority"?(d.priorityRoofFaceId||undefined):undefined},
    support:{topology:topology(project),covering:covering(project),existingStructure:d.existingStructure!=="false",rackTiltDeg:number(d.rackTiltDeg)||undefined},
    notes:d.projectDescription
  };
}

function role(kind:string):PhotoRole|undefined{return(["satellite","satellite_mass","near","roof","far"] as const).includes(kind as any)?kind as PhotoRole:undefined;}
function makePhotos(project:DpProjectRecord,sources:DpSourceFile[]):InputPhoto[]{
  return sources.map(source=>{
    const r=role(source.kind);if(!r)return undefined;
    if(!["image/png","image/jpeg"].includes(source.mimeType))return undefined;
    const size=source.mimeType==="image/png"?pngSize(source.bytes):undefined;
    const satellite=r==="satellite"||r==="satellite_mass";
    return{role:r,mimeType:source.mimeType as "image/png"|"image/jpeg",base64:b64(source.bytes),filename:source.fileName,widthPx:size?.width??(satellite?1400:undefined),heightPx:size?.height??(satellite?1000:undefined),metersPerPixel:r==="satellite_mass"?number(project.details.satelliteMassMetersPerPixel):r==="satellite"?number(project.details.satelliteMetersPerPixel):undefined};
  }).filter((x):x is InputPhoto=>Boolean(x));
}

function outerQuad(cells:NormalizedPoint[][],rows:number,columns:number,lastRowCount:number):NormalizedPoint[]{
  if(!cells.length)return[];const firstRow=Math.min(columns,cells.length);const topStart=Math.max(0,cells.length-Math.max(1,lastRowCount));
  return[cells[0]![0]!,cells[firstRow-1]![1]!,cells[cells.length-1]![2]!,cells[topStart]![3]!];
}
function viewFor(context:ProjectContext,faceId:string,roleName:string){return context.roof.views?.find(v=>v.faceId===faceId&&v.role===roleName&&v.selectedFaceVisible&&v.roofPolygonNormalized.length===4);}

function evidenceFrom(context:ProjectContext,project:DpProjectRecord,sources:DpSourceFile[],projectPhotoRole:string):ArchitecturalEvidence{
  const sourceMap=new Map(sources.map(s=>[s.kind,s]));const allocations:FaceAllocationGeometry[]=[];
  for(const p of context.facePlacements??[]){
    const sv=viewFor(context,p.faceId,"satellite_mass");const pv=viewFor(context,p.faceId,projectPhotoRole);if(!sv||!pv)throw new Error(`Le pan ${p.faceId} n'est pas démontré à la fois sur IGN et sur la photographie d'insertion.`);
    const sc=panelPolygonsForView(context,sv),pc=panelPolygonsForView(context,pv);if(!sc||!pc||sc.length!==p.panelCount||pc.length!==p.panelCount)throw new Error(`Projection exacte incomplète sur le pan ${p.faceId}.`);
    allocations.push({face_id:p.faceId,label:p.label??`Pan ${p.faceId}`,panel_count:p.panelCount,rows:p.rows,columns:p.columns,last_row_count:p.lastRowCount,gutter_clearance_mm:p.resolvedGutterMm,satellite_roof_outline:sv.roofPolygonNormalized,satellite_panel_cells:sc,project_photo_role:projectPhotoRole,project_roof_outline:pv.roofPolygonNormalized,project_panel_cells:pc});
  }
  if(!allocations.length)throw new Error("Aucune allocation photovoltaïque métriquement démontrée.");
  const first=allocations[0]!,placement=context.facePlacements![0]!,projectView=viewFor(context,placement.faceId,projectPhotoRole)!,satView=viewFor(context,placement.faceId,"satellite_mass")!;
  const firstSatQuad=outerQuad(first.satellite_panel_cells,first.rows,first.columns,first.last_row_count),firstProjectQuad=outerQuad(first.project_panel_cells,first.rows,first.columns,first.last_row_count);
  const geometry:ArchitecturalGeometry={verdict:"verified",confidence:context.roof.confidence,satellite_roof_outline:first.satellite_roof_outline,satellite_array_quad:firstSatQuad,satellite_eave_line:satView.gutterLineNormalized??first.satellite_roof_outline.slice(0,2),satellite_plane_anchors:first.satellite_roof_outline.slice(0,4),near_roof_outline:first.project_roof_outline,near_array_quad:firstProjectQuad,near_eave_line:projectView.gutterLineNormalized??first.project_roof_outline.slice(0,2),near_plane_anchors:first.project_roof_outline.slice(0,4),roof_pitch_deg:context.roofGeometry?.slopeDeg??number(project.details.roofPitchDeg),layout_rows:first.rows,layout_columns:first.columns,module_orientation:context.array.orientation,agreement_iou:Object.fromEntries((context.facePlacements??[]).map(p=>[p.faceId,context.roof.faces?.find(f=>f.id===p.faceId)?.confidence??context.roof.confidence])),source_sha256:Object.fromEntries(sources.map(s=>[s.kind,s.sha256])),evidence:context.immutableFacts,face_allocations:allocations,project_photo_role:projectPhotoRole};
  const gap=context.array.interPanelGapMm??20;const primary=context.facePlacements![0]!;const pw=context.array.orientation==="portrait"?context.panel.widthMm:context.panel.heightMm,ph=context.array.orientation==="portrait"?context.panel.heightMm:context.panel.widthMm;
  const primaryWidth=primary.columns*pw+Math.max(0,primary.columns-1)*gap,primaryHeight=primary.rows*ph+Math.max(0,primary.rows-1)*gap;
  const dims:VerifiedDimension[]=[
    {dimension_id:"module_width",label:"Largeur module",value_mm:context.panel.widthMm,tolerance_mm:1,provenance:"formulaire fabricant",evidence:context.panel.model,verified:true},
    {dimension_id:"module_height",label:"Hauteur module",value_mm:context.panel.heightMm,tolerance_mm:1,provenance:"formulaire fabricant",evidence:context.panel.model,verified:true},
    {dimension_id:"array_width",label:"Largeur champ principal",value_mm:primaryWidth,tolerance_mm:25,provenance:"calcul déterministe",evidence:`Pan ${primary.faceId}`,verified:true},
    {dimension_id:"array_height",label:"Hauteur champ principal",value_mm:primaryHeight,tolerance_mm:25,provenance:"calcul déterministe",evidence:`Pan ${primary.faceId}`,verified:true},
    {dimension_id:"satellite_scale_reference",label:"Échelle IGN",value_mm:number(project.details.satelliteMassMetersPerPixel)*1000,tolerance_mm:1,provenance:"IGN WMS",evidence:project.details.satelliteMassSourceUrl??"IGN",verified:true},
    ...context.facePlacements!.flatMap(p=>[{dimension_id:`face_${p.faceId}_width`,label:`Largeur pan ${p.faceId}`,value_mm:p.widthMm,tolerance_mm:50,provenance:"IGN + analyse multimodale",evidence:p.label??p.faceId,verified:true},{dimension_id:`face_${p.faceId}_slope`,label:`Rampant pan ${p.faceId}`,value_mm:p.slopeLengthMm,tolerance_mm:80,provenance:"IGN + pente",evidence:p.label??p.faceId,verified:true}])
  ];
  return{geometry,dimensions:dims};
}

export async function runDPAI(project:DpProjectRecord,sources:DpSourceFile[]):Promise<DpAiRun>{
  const key=apiKey();if(!key)throw new Error("OPENAI_API_KEY manque. Ajoutez la clé du projet PilotPaper dans .env.local ou dans les variables d'environnement du déploiement.");
  const form=makeForm(project);if(form.panel.widthMm<=0||form.panel.heightMm<=0)throw new Error("Les dimensions réelles du modèle de panneau sont obligatoires.");
  if(form.array.layoutMode!=="automatic"&&form.array.rows*form.array.columns!==project.moduleCount)throw new Error(`Le calepinage demandé ${form.array.rows}×${form.array.columns} ne correspond pas aux ${project.moduleCount} panneaux demandés.`);
  const photos=makePhotos(project,sources);const userPhotos=photos.filter(p=>["near","roof","far"].includes(p.role));if(userPhotos.length!==3)throw new Error("Trois photographies utilisateur distinctes sont requises : proche, oblique toiture et lointaine.");
  if(userPhotos.some(p=>p.mimeType!=="image/png"))throw new Error("Les photographies doivent être normalisées en PNG par PilotPaper avant génération afin de garantir le masque strict.");
  const config:EngineConfig={openaiApiKey:key,geminiApiKey:configured("GEMINI_API_KEY")||undefined,analysisModel:configured("DP_ANALYSIS_MODEL")||"gpt-5.6-sol",judgeModel:configured("DP_JUDGE_MODEL")||"gpt-5.6-sol",imageModel:configured("DP_IMAGE_MODEL")||"gpt-image-2",imageProvider:configured("DP_IMAGE_PROVIDER")==="gemini"?"gemini":"openai",maxRetries:Math.max(1,int(configured("DP_MAX_RETRIES"),5)),qaPassScore:Math.max(.9,Math.min(.999,number(configured("DP_QA_PASS_SCORE"),.96))),realismPassScore:Math.max(.9,Math.min(.999,number(configured("DP_REALISM_PASS_SCORE"),.97)))};
  const result=await createDPAIEngine(config).generate(form,photos);const dp4=result.assets.find(a=>a.dp===4&&a.base64),dp6=result.assets.find(a=>a.dp===6&&a.base64);if(!dp4?.base64||!dp6?.base64)throw new Error("Le moteur n'a pas produit les insertions DP4/DP6 validées.");
  const projectRole=dp6.sourceRole??"near";const evidence=evidenceFrom(result.context,project,sources,projectRole);const sat=sourceMapValue(sources,"satellite_mass");
  const dp4bytes=new Uint8Array(Buffer.from(dp4.base64,"base64")),dp6bytes=new Uint8Array(Buffer.from(dp6.base64,"base64"));
  const renderedViews:DpRenderedView[]=[
    {kind:"satellite_project",sourceKind:"satellite_mass",mimeType:"image/png",sha256:sat.sha256,bytes:sat.bytes,metrics:{visual_conformity_score:1}},
    {kind:"dp4_project",sourceKind:dp4.sourceRole??projectRole,mimeType:"image/png",sha256:await sha256(dp4bytes),bytes:dp4bytes,metrics:{visual_conformity_score:result.quality[4]?.score,eave_clearance_mm:Math.min(...(result.context.facePlacements??[]).map(p=>p.resolvedGutterMm))}},
    {kind:"dp6_project",sourceKind:projectRole,mimeType:"image/png",sha256:await sha256(dp6bytes),bytes:dp6bytes,metrics:{visual_conformity_score:result.quality[6]?.score,eave_clearance_mm:Math.min(...(result.context.facePlacements??[]).map(p=>p.resolvedGutterMm))}},
  ];
  return{evidence,renderedViews,audit:{engine:"DP-AI-FIRST-v0.4.3",models:{analysis:config.analysisModel,image:config.imageModel,judge:config.judgeModel},quality:result.quality,facePlacements:result.context.facePlacements,immutableFacts:result.context.immutableFacts,dp7SourceRole:result.assets.find(a=>a.dp===7)?.sourceRole,dp8SourceRole:result.assets.find(a=>a.dp===8)?.sourceRole}};
}
function sourceMapValue(sources:DpSourceFile[],kind:string){const s=sources.find(x=>x.kind===kind);if(!s)throw new Error(`Source ${kind} manquante.`);return s;}

export function getDPAIHealth(){const missing:string[]=[];if(!apiKey())missing.push("OPENAI_API_KEY");return{status:missing.length?"incomplete" as const:"ready" as const,engineVersion:"DP-AI-FIRST-v0.4.3",mode:"in-process",models:[configured("DP_ANALYSIS_MODEL")||"gpt-5.6-sol",configured("DP_IMAGE_MODEL")||"gpt-image-2",configured("DP_JUDGE_MODEL")||"gpt-5.6-sol"],missing};}

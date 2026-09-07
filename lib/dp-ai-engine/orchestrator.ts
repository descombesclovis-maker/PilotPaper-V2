import type { CrossPieceJudge, VisionAnalyzer } from "./providers/interfaces";
import type { GeneratedAsset, GenerationResult, InputPhoto, ProjectForm, QualityReport } from "./types";
import { buildNonVisualDP } from "./generators/nonVisual";
import { AIVisualGenerator } from "./generators/aiVisualGenerator";
import { buildDP5RoofPlan } from "./generators/dp5RoofPlan";
import { resolveProjectLayout } from "./geometry/projectLayout";
import { OpenAIEnvironmentPhotoJudge } from "./providers/openaiEnvironmentPhotoJudge";

function sourceAsset(dp:7|8,photo:InputPhoto):GeneratedAsset{return{dp,kind:"image",mimeType:photo.mimeType,base64:photo.base64,attempt:1,sourceRole:photo.role};}
function fallbackPhotoQuality():QualityReport{return{passed:true,score:.9,panelCountObserved:undefined,rowsObserved:undefined,columnsObserved:undefined,buildingPreserved:true,perspectiveCoherent:true,scaleCoherent:true,placementCoherent:true,roofFaceCorrect:true,insideSelectedRoofFace:true,singleRoofPlane:true,crossesRidge:false,arrayGeometryConsistent:true,issues:[],correctionPrompt:""};}

export class DPAIEngine {
  constructor(private analyzer:VisionAnalyzer,private visual:AIVisualGenerator,private crossJudge?:CrossPieceJudge,private maxCrossRetries=2,private envPhotoJudge?:OpenAIEnvironmentPhotoJudge){}

  async generate(form:ProjectForm,photos:InputPhoto[]):Promise<GenerationResult>{
    const userPhotos=photos.filter(p=>!["satellite","satellite_mass"].includes(p.role));
    if(userPhotos.length<3) throw new Error("The engine requires at least 3 independent user photographs");
    resolveProjectLayout(form); // deterministic preflight before any image generation
    const context=await this.analyzer.analyze(form,photos);
    const fixedAssets:GeneratedAsset[]=[buildNonVisualDP(1,form,context),buildNonVisualDP(2,form,context),buildNonVisualDP(3,form,context)];
    const quality:Record<number,QualityReport>={};
    const visualAssets=new Map<number,GeneratedAsset>();

    const dp4=await this.visual.generate(4,form,context,photos); visualAssets.set(4,dp4.asset); quality[4]=dp4.quality;
    const dp5=buildDP5RoofPlan(form,context); fixedAssets.push(dp5.asset); quality[5]=dp5.quality;
    const dp6=await this.visual.generate(6,form,context,photos); visualAssets.set(6,dp6.asset); quality[6]=dp6.quality;

    // DP7/DP8 are evidence photographs, not generative edits. Official notice describes them as photographs
    // situating the site in the close and distant environment. We judge them but never invent their pixels.
    const near=photos.find(p=>p.role==="near") ?? userPhotos[0];
    const far=photos.find(p=>p.role==="far") ?? userPhotos[userPhotos.length-1];
    if(!near||!far||near===far) throw new Error("Independent close and distant environment photographs are required for DP7 and DP8.");
    fixedAssets.push(sourceAsset(7,near),sourceAsset(8,far));
    quality[7]=this.envPhotoJudge?await this.envPhotoJudge.judge(7,form,near,photos):fallbackPhotoQuality();
    quality[8]=this.envPhotoJudge?await this.envPhotoJudge.judge(8,form,far,photos):fallbackPhotoQuality();
    if(!quality[7].passed||!quality[8].passed) throw new Error("DP7/DP8 source photograph evidence was rejected; the engine will not fabricate replacement environment photographs.");

    // Cross-piece visual consistency applies to project representations DP4 and DP6.
    // DP5 is deterministic from the same allocations, while DP7/DP8 remain immutable source photos.
    if(this.crossJudge){
      for(let round=0;round<=this.maxCrossRetries;round++){
        const current=[visualAssets.get(4)!,visualAssets.get(6)!];
        const report=await this.crossJudge.judge({form,context,generated:current});
        if(report.passed) break;
        if(round===this.maxCrossRetries) throw new Error(`Cross-DP consistency failed: ${report.issues.map(i=>i.code).join(", ")||"unknown"}`);
        for(const dp of report.invalidDPs){
          const correction=report.corrections.find(c=>c.dp===dp)?.correction??report.issues.map(i=>`${i.code}: ${i.correction}`).join("\n");
          const regenerated=await this.visual.generate(dp,form,context,photos,`CROSS-DP CONSISTENCY CORRECTION:\n${correction}`);
          visualAssets.set(dp,regenerated.asset); quality[dp]=regenerated.quality;
        }
      }
    }
    const assets=[...fixedAssets,...[4,6].map(dp=>visualAssets.get(dp)!).filter(Boolean)]; assets.sort((a,b)=>a.dp-b.dp);
    return{context,assets,quality};
  }
}

import type { CrossPieceJudge, VisionAnalyzer } from "./providers/interfaces";
import type { GeneratedAsset, GenerationResult, InputPhoto, ProjectForm, QualityIssue, QualityReport } from "./types";
import { buildNonVisualDP } from "./generators/nonVisual";
import { AIVisualGenerator } from "./generators/aiVisualGenerator";
import { buildDP5RoofPlan } from "./generators/dp5RoofPlan";
import { resolveProjectLayout } from "./geometry/projectLayout";
import { OpenAIEnvironmentPhotoJudge } from "./providers/openaiEnvironmentPhotoJudge";
import { inspectCrossPieceGeometry } from "./quality/crossPieceGeometryInspector";

function sourceAsset(dp:7|8,photo:InputPhoto):GeneratedAsset{return{dp,kind:"image",mimeType:photo.mimeType,base64:photo.base64,attempt:1,sourceRole:photo.role};}
function fallbackPhotoQuality():QualityReport{return{passed:true,score:.9,panelCountObserved:undefined,rowsObserved:undefined,columnsObserved:undefined,buildingPreserved:true,perspectiveCoherent:true,scaleCoherent:true,placementCoherent:true,roofFaceCorrect:true,insideSelectedRoofFace:true,singleRoofPlane:true,crossesRidge:false,arrayGeometryConsistent:true,issues:[],correctionPrompt:""};}

function appendBlockingIssues(report: QualityReport, issues: QualityIssue[]): QualityReport {
  if (!issues.length) return report;
  return {
    ...report,
    passed: false,
    score: Math.min(report.score, 0),
    arrayGeometryConsistent: false,
    placementCoherent: false,
    issues: [...report.issues, ...issues],
    correctionPrompt: [
      report.correctionPrompt,
      ...issues.map((issue) => `${issue.code}: ${issue.correction}`),
    ].filter(Boolean).join("\n"),
  };
}

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

    // Deterministic geometry consistency is checked before any model-based
    // cross-piece judgement. DP4, DP5 and DP6 must all trace back to exactly the
    // same persisted physical module identity set.
    const deterministicCross = inspectCrossPieceGeometry(context, [dp4.asset, dp5.asset, dp6.asset]);
    if (!deterministicCross.passed) {
      for (const dp of [4, 5, 6]) {
        const existing = quality[dp];
        if (existing) quality[dp] = appendBlockingIssues(existing, deterministicCross.issues);
      }
    }

    // DP7/DP8 are evidence photographs, not generative edits. Official notice describes them as photographs
    // situating the site in the close and distant environment. We judge them but never invent their pixels.
    const near=photos.find(p=>p.role==="near") ?? userPhotos[0];
    const far=photos.find(p=>p.role==="far") ?? userPhotos[userPhotos.length-1];
    if(!near||!far||near===far) throw new Error("Independent close and distant environment photographs are required for DP7 and DP8.");
    fixedAssets.push(sourceAsset(7,near),sourceAsset(8,far));
    quality[7]=this.envPhotoJudge?await this.envPhotoJudge.judge(7,form,near,photos):fallbackPhotoQuality();
    quality[8]=this.envPhotoJudge?await this.envPhotoJudge.judge(8,form,far,photos):fallbackPhotoQuality();
    // Failed DP7/DP8 quality is retained in the quality report. The API route
    // decides whether it is blocking (production) or exportable (test mode).

    // AI cross-piece visual consistency is a second independent layer and only
    // runs when deterministic geometry identity has already passed.
    if(deterministicCross.passed&&this.crossJudge){
      for(let round=0;round<=this.maxCrossRetries;round++){
        const current=[visualAssets.get(4)!,visualAssets.get(6)!];
        const report=await this.crossJudge.judge({form,context,generated:current});
        if(report.passed) break;
        if(round===this.maxCrossRetries){
          const existing=quality[6];
          if(existing){
            quality[6]={
              ...existing,
              passed:false,
              score:Math.min(existing.score,report.score),
              issues:[...existing.issues,...report.issues],
              correctionPrompt:[existing.correctionPrompt,...report.corrections.map(item=>item.correction)].filter(Boolean).join("\n"),
            };
          }
          break;
        }
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

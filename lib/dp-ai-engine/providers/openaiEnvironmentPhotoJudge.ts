import type { InputPhoto, ProjectForm, QualityReport } from "../types";
import { openaiJson } from "./openaiJson";
import { toDataUrl } from "../utils/dataUrl";
import { environmentPhotoJudgePrompt } from "../prompts/environmentPhotoJudge";

const schema={type:"object",additionalProperties:false,properties:{passed:{type:"boolean"},score:{type:"number",minimum:0,maximum:1},panelCountObserved:{type:["integer","null"]},rowsObserved:{type:["integer","null"]},columnsObserved:{type:["integer","null"]},buildingPreserved:{type:"boolean"},perspectiveCoherent:{type:"boolean"},scaleCoherent:{type:"boolean"},placementCoherent:{type:"boolean"},roofFaceCorrect:{type:"boolean"},insideSelectedRoofFace:{type:"boolean"},singleRoofPlane:{type:"boolean"},crossesRidge:{type:"boolean"},arrayGeometryConsistent:{type:"boolean"},issues:{type:"array",items:{type:"object",additionalProperties:false,properties:{code:{type:"string"},severity:{type:"string",enum:["warning","error","fatal"]},message:{type:"string"},correction:{type:"string"}},required:["code","severity","message","correction"]}},correctionPrompt:{type:"string"}},required:["passed","score","panelCountObserved","rowsObserved","columnsObserved","buildingPreserved","perspectiveCoherent","scaleCoherent","placementCoherent","roofFaceCorrect","insideSelectedRoofFace","singleRoofPlane","crossesRidge","arrayGeometryConsistent","issues","correctionPrompt"]} as const;

export class OpenAIEnvironmentPhotoJudge {
  constructor(private apiKey:string,private model="gpt-5.6-sol",private passScore=.92){}
  async judge(dp:7|8,form:ProjectForm,photo:InputPhoto,allPhotos:InputPhoto[]):Promise<QualityReport>{
    const refs=allPhotos.filter(p=>!["satellite","satellite_mass"].includes(p.role)&&p!==photo).slice(0,2);
    const report=await openaiJson<QualityReport>({apiKey:this.apiKey,model:this.model,prompt:environmentPhotoJudgePrompt(dp,form),imageDataUrls:[toDataUrl(photo),...refs.map(toDataUrl)],schemaName:`dp${dp}_environment_photo_quality`,schema:schema as unknown as Record<string,unknown>});
    report.passed=Boolean(report.passed&&report.score>=this.passScore&&!report.issues.some(i=>i.severity==="fatal"));
    return report;
  }
}

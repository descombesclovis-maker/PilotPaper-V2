import type { CrossPieceJudge } from "./interfaces";
import type { CrossPieceQualityReport } from "../types";
import { crossPieceJudgePrompt } from "../prompts/crossPieceJudge";
import { openaiJson } from "./openaiJson";
const schema={type:"object",additionalProperties:false,properties:{passed:{type:"boolean"},score:{type:"number",minimum:0,maximum:1},samePanelCount:{type:"boolean"},sameLayout:{type:"boolean"},sameRoofFace:{type:"boolean"},sameRelativePlacement:{type:"boolean"},sameArrayIdentity:{type:"boolean"},invalidDPs:{type:"array",items:{type:"integer",enum:[4,6]}},issues:{type:"array",items:{type:"object",additionalProperties:false,properties:{code:{type:"string"},severity:{type:"string",enum:["warning","error","fatal"]},message:{type:"string"},correction:{type:"string"}},required:["code","severity","message","correction"]}},corrections:{type:"array",items:{type:"object",additionalProperties:false,properties:{dp:{type:"integer",enum:[4,6]},correction:{type:"string"}},required:["dp","correction"]}}},required:["passed","score","samePanelCount","sameLayout","sameRoofFace","sameRelativePlacement","sameArrayIdentity","invalidDPs","issues","corrections"]} as const;
export class OpenAICrossPieceJudge implements CrossPieceJudge{
 constructor(private apiKey:string,private model="gpt-5.6-sol",private passScore=.97){}
 async judge({form,context,generated}:Parameters<CrossPieceJudge["judge"]>[0]):Promise<CrossPieceQualityReport>{
  const visual=generated.filter(a=>[4,6].includes(a.dp)&&a.base64).sort((a,b)=>a.dp-b.dp);
  if(visual.length!==2) throw new Error("Cross-piece QA requires DP4 and DP6 image assets");
  const report=await openaiJson<CrossPieceQualityReport>({apiKey:this.apiKey,model:this.model,prompt:crossPieceJudgePrompt(form,context,visual.map(a=>a.dp)),imageDataUrls:visual.map(a=>`data:${a.mimeType};base64,${a.base64}`),schemaName:"dp_cross_piece_quality",schema:schema as unknown as Record<string,unknown>});
  const hard=!report.samePanelCount||!report.sameLayout||!report.sameRoofFace||!report.sameRelativePlacement||!report.sameArrayIdentity||report.invalidDPs.length>0||report.issues.some(i=>i.severity==="fatal");
  report.passed=Boolean(report.passed&&report.score>=this.passScore&&!hard);return report;
 }
}

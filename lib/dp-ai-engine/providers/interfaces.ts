import type { GeneratedAsset, InputPhoto, ProjectContext, ProjectForm, QualityReport, CrossPieceQualityReport, DPNumber } from "../types";

export interface VisionAnalyzer {
  analyze(form: ProjectForm, photos: InputPhoto[]): Promise<ProjectContext>;
}

export interface ImageEditor {
  edit(params: {
    dp: DPNumber;
    context: ProjectContext;
    photos: InputPhoto[];
    prompt: string;
    previous?: GeneratedAsset;
  }): Promise<GeneratedAsset>;
}

export interface QualityJudge {
  judge(params: {
    dp: DPNumber;
    form: ProjectForm;
    context: ProjectContext;
    originalPhotos: InputPhoto[];
    generated: GeneratedAsset;
  }): Promise<QualityReport>;
}

export interface CrossPieceJudge {
  judge(params: {
    form: ProjectForm;
    context: ProjectContext;
    generated: GeneratedAsset[];
  }): Promise<CrossPieceQualityReport>;
}

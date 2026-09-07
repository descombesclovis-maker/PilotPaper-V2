import type { DPNumber, InputPhoto, ProjectContext, PhotoRole } from "../types";

const rolePreference:Partial<Record<DPNumber,PhotoRole[]>>={
  4:["front","near","roof","left_oblique","right_oblique","far"],
  6:["near","front","roof","left_oblique","right_oblique","far"],
  7:["near","front","left_oblique","right_oblique","far"],
  8:["far","front","near","left_oblique","right_oblique"]
};

export function prioritizePhotos(dp:DPNumber,photos:InputPhoto[],context:ProjectContext):InputPhoto[]{
  const pref=rolePreference[dp]??["near","front","roof","left_oblique","right_oblique","far"];
  const confidence=(role:PhotoRole)=>Math.max(0,...(context.roof.views??[]).filter(v=>v.role===role&&v.selectedFaceVisible).map(v=>v.confidence));
  return [...photos].filter(p=>!["satellite","satellite_mass"].includes(p.role)).sort((a,b)=>{
    const av=confidence(a.role),bv=confidence(b.role);
    if(Math.abs(bv-av)>.05) return bv-av;
    const ai=pref.indexOf(a.role),bi=pref.indexOf(b.role);
    return (ai<0?99:ai)-(bi<0?99:bi);
  });
}

export function roofPolygonsForPhoto(photo:InputPhoto,context:ProjectContext){
  const allocated=new Set((context.facePlacements??[]).map(p=>p.faceId));
  const views=(context.roof.views??[]).filter(v=>v.role===photo.role&&v.selectedFaceVisible&&(!allocated.size||!v.faceId||allocated.has(v.faceId)));
  return views.map(v=>v.roofPolygonNormalized).filter(p=>p.length>=3);
}

export function roofPolygonForPhoto(photo:InputPhoto,context:ProjectContext){
  return roofPolygonsForPhoto(photo,context)[0] ?? context.roof.roofPolygonNormalized;
}

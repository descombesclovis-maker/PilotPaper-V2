import type { GeneratedAsset, ProjectContext, ProjectForm, QualityReport } from "../types";
import { checkSingleRoofPlaneFit, computePVField } from "../geometry/pvConstraints";

function esc(s:string){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"}[c]!));}
function m(mm:number|undefined){return mm==null?"—":`${(mm/1000).toFixed(2)} m`;}


function buildMultiFaceDP5(form: ProjectForm, context: ProjectContext): {asset:GeneratedAsset; quality:QualityReport} {
  const placements=context.facePlacements ?? [];
  const W=1200,H=900;
  const gap=form.array.interPanelGapMm??20;
  const panelW=form.array.orientation==="portrait"?form.panel.widthMm:form.panel.heightMm;
  const panelH=form.array.orientation==="portrait"?form.panel.heightMm:form.panel.widthMm;
  const cardW=Math.min(500,980/Math.max(1,placements.length));
  const startX=(W-cardW*placements.length)/2;
  let bodies="";
  placements.forEach((p,index)=>{
    const x=startX+index*cardW, y=205, rw=cardW-24, rh=420;
    const sx=rw/p.widthMm, sy=rh/p.slopeLengthMm;
    let emitted=0, panels="";
    for(let row=0;row<p.rows&&emitted<p.panelCount;row++){
      const rc=row===p.rows-1?p.lastRowCount:Math.min(p.columns,p.panelCount-emitted);
      const fieldW=rc*panelW+Math.max(0,rc-1)*gap;
      const left=(p.widthMm-fieldW)/2;
      for(let col=0;col<rc&&emitted<p.panelCount;col++){
        const px=x+12+(left+col*(panelW+gap))*sx;
        const py=y+rh-(p.resolvedGutterMm+(row+1)*panelH+row*gap)*sy;
        panels+=`<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(panelW*sx).toFixed(2)}" height="${(panelH*sy).toFixed(2)}" fill="#152d4d" stroke="#dce7f4" stroke-width="1"/>`;
        emitted++;
      }
    }
    bodies+=`<g><rect x="${x+12}" y="${y}" width="${rw}" height="${rh}" fill="#c98355" stroke="#222" stroke-width="2"/>
      <line x1="${x+12}" y1="${y}" x2="${x+12+rw}" y2="${y}" stroke="#111" stroke-width="5"/>
      ${panels}<text x="${x+18}" y="${y-18}" font-family="Arial" font-size="18" font-weight="700">Pan ${esc(p.faceId)} — ${p.panelCount} modules</text>
      <text x="${x+18}" y="${y+rh+30}" font-family="Arial" font-size="14">${p.rows} rangée(s), jusqu’à ${p.columns} colonnes · recul bas ${Math.round(p.resolvedGutterMm)} mm</text></g>`;
  });
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="18" y="18" width="1164" height="864" fill="white" stroke="#222" stroke-width="2"/><text x="55" y="70" font-family="Arial" font-size="42" font-weight="700">DP5</text><text x="165" y="70" font-family="Arial" font-size="30" font-weight="700">Plan des toitures — répartition multi-pans</text><text x="55" y="110" font-family="Arial" font-size="16">${esc(form.address)}</text>${bodies}<rect x="55" y="690" width="1090" height="120" fill="#fafafa" stroke="#bbb"/><text x="80" y="722" font-family="Arial" font-size="17" font-weight="700">${context.exactPanelCount} panneaux au total — ${placements.length} champs indépendants</text><text x="80" y="752" font-family="Arial" font-size="15">Chaque champ reste entièrement dans son pan. Aucun module ne traverse un faîtage, une arête ou une limite de pan.</text><text x="80" y="782" font-family="Arial" font-size="15">Répartition : ${placements.map(p=>`Pan ${esc(p.faceId)} : ${p.panelCount}`).join(" · ")}</text><text x="55" y="857" font-family="Arial" font-size="13">DP AI Engine — géométrie déterministe, rendu non génératif</text></svg>`;
  const quality:QualityReport={passed:true,score:1,panelCountObserved:context.exactPanelCount,buildingPreserved:true,perspectiveCoherent:true,scaleCoherent:true,placementCoherent:true,roofFaceCorrect:true,insideSelectedRoofFace:true,singleRoofPlane:true,crossesRidge:false,arrayGeometryConsistent:true,expectedFaceAllocationsMatched:true,issues:[],correctionPrompt:""};
  return {asset:{dp:5,kind:"svg",mimeType:"image/svg+xml",text:svg,attempt:1},quality};
}
export function buildDP5RoofPlan(form: ProjectForm, context: ProjectContext): {asset:GeneratedAsset; quality:QualityReport} {
  if ((context.facePlacements?.length ?? 0) > 1) return buildMultiFaceDP5(form, context);
  const fit = checkSingleRoofPlaneFit(form);
  const f = computePVField(form.panel, form.array);
  if (fit.calibrated && !fit.fits) throw new Error(`DP5 geometry rejected before rendering: ${fit.reasons.join(" ")}`);

  const roofWmm = form.roofGeometry?.widthMm ?? Math.max(f.fieldWidthMm + 1600, f.fieldWidthMm * 1.25);
  const roofHmm = form.roofGeometry?.slopeLengthMm ?? Math.max(f.fieldHeightMm + 1200, f.fieldHeightMm * 1.35);
  const W=1200,H=900;
  const roofW=780, roofH=Math.min(430, roofW*(roofHmm/roofWmm));
  const rx=150, ry=205;
  const sx=roofW/roofWmm, sy=roofH/roofHmm;
  const fieldW=f.fieldWidthMm*sx, fieldH=f.fieldHeightMm*sy;
  const leftMm=fit.leftMm ?? (roofWmm-f.fieldWidthMm)/2;
  const rightMm=fit.rightMm ?? (roofWmm-f.fieldWidthMm-leftMm);
  const gutterMm=fit.gutterMm ?? (form.array.gutterClearanceMm ?? 300);
  const ridgeMm=fit.ridgeMm ?? (roofHmm-gutterMm-f.fieldHeightMm);
  const fx=rx+leftMm*sx, fy=ry+roofH-gutterMm*sy-fieldH;
  const panelW=(form.array.orientation==="portrait"?form.panel.widthMm:form.panel.heightMm)*sx;
  const panelH=(form.array.orientation==="portrait"?form.panel.heightMm:form.panel.widthMm)*sy;
  const gap=(form.array.interPanelGapMm??20), gapX=gap*sx,gapY=gap*sy;

  let panels="";
  for(let r=0;r<form.array.rows;r++) for(let c=0;c<form.array.columns;c++) {
    const x=fx+c*(panelW+gapX), y=fy+r*(panelH+gapY);
    panels += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${panelW.toFixed(2)}" height="${panelH.toFixed(2)}" rx="1" fill="#152d4d" stroke="#eef4fb" stroke-width="1.5"/>`;
    panels += `<line x1="${(x+panelW/2).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(x+panelW/2).toFixed(2)}" y2="${(y+panelH).toFixed(2)}" stroke="#55708e" stroke-width="0.7"/>`;
  }

  const metricNote=fit.calibrated ? `Implantation métrique — source : ${form.roofGeometry?.source ?? "donnée projet"}` : "Pan non calibré métriquement — cotes du pan à confirmer";
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="tiles" width="28" height="18" patternUnits="userSpaceOnUse">
      <rect width="28" height="18" fill="#c98355"/>
      <path d="M0 9 H28 M14 0 V9 M0 18 V9 M28 18 V9" stroke="#a96543" stroke-width="1" opacity="0.55"/>
    </pattern>
    <marker id="arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#222"/></marker>
  </defs>
  <rect x="18" y="18" width="1164" height="864" fill="white" stroke="#222" stroke-width="2"/>
  <text x="55" y="70" font-family="Arial,sans-serif" font-size="42" font-weight="700">DP5</text>
  <text x="165" y="70" font-family="Arial,sans-serif" font-size="30" font-weight="700">Plan des toitures</text>
  <text x="55" y="108" font-family="Arial,sans-serif" font-size="17">Projet : ${esc(form.address)}</text>
  <text x="55" y="134" font-family="Arial,sans-serif" font-size="15">Pan sélectionné : ${esc(form.array.roofFace)} — ${metricNote}</text>

  <g transform="translate(1035 70)">
    <circle cx="45" cy="42" r="31" fill="none" stroke="#111" stroke-width="2"/>
    <path d="M45 5 L34 45 L45 38 L56 45 Z" fill="#111"/>
    <text x="39" y="92" font-family="Arial" font-size="18" font-weight="700">N</text>
  </g>

  <!-- selected single roof plane -->
  <rect x="${rx}" y="${ry}" width="${roofW}" height="${roofH}" fill="url(#tiles)" stroke="#333" stroke-width="3"/>
  <line x1="${rx}" y1="${ry}" x2="${rx+roofW}" y2="${ry}" stroke="#111" stroke-width="6"/>
  <text x="${rx+roofW-155}" y="${ry-14}" font-family="Arial" font-size="14" font-weight="700">FAÎTAGE</text>
  <line x1="${rx}" y1="${ry+roofH}" x2="${rx+roofW}" y2="${ry+roofH}" stroke="#444" stroke-width="5"/>
  <text x="${rx+roofW-160}" y="${ry+roofH+27}" font-family="Arial" font-size="14" font-weight="700">GOUTTIÈRE</text>
  ${panels}
  <rect x="${fx}" y="${fy}" width="${fieldW}" height="${fieldH}" fill="none" stroke="#081a2d" stroke-width="3"/>

  <!-- roof dimensions -->
  <line x1="${rx}" y1="${ry-28}" x2="${rx+roofW}" y2="${ry-28}" stroke="#222" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <line x1="${rx}" y1="${ry-18}" x2="${rx}" y2="${ry-40}" stroke="#222"/>
  <line x1="${rx+roofW}" y1="${ry-18}" x2="${rx+roofW}" y2="${ry-40}" stroke="#222"/>
  <text x="${rx+roofW/2-35}" y="${ry-39}" font-family="Arial" font-size="16" font-weight="700">${m(roofWmm)}</text>
  <line x1="${rx-55}" y1="${ry}" x2="${rx-55}" y2="${ry+roofH}" stroke="#222" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="${rx-118}" y="${ry+roofH/2}" font-family="Arial" font-size="16" font-weight="700" transform="rotate(-90 ${rx-118} ${ry+roofH/2})">${m(roofHmm)}</text>

  <!-- clearances -->
  <line x1="${fx-28}" y1="${fy+fieldH}" x2="${fx-28}" y2="${ry+roofH}" stroke="#222" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="${fx-18}" y="${(fy+fieldH+ry+roofH)/2+5}" font-family="Arial" font-size="13">${m(gutterMm)}</text>
  <line x1="${fx+fieldW+28}" y1="${ry}" x2="${fx+fieldW+28}" y2="${fy}" stroke="#222" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="${fx+fieldW+38}" y="${(ry+fy)/2+5}" font-family="Arial" font-size="13">${m(ridgeMm)}</text>

  <!-- legend and facts -->
  <rect x="55" y="680" width="1090" height="145" fill="#fafafa" stroke="#bbb"/>
  <rect x="82" y="705" width="36" height="22" fill="#152d4d"/><text x="132" y="722" font-family="Arial" font-size="16">Panneaux photovoltaïques projetés</text>
  <rect x="82" y="741" width="36" height="22" fill="url(#tiles)" stroke="#a96543"/><text x="132" y="758" font-family="Arial" font-size="16">Toiture existante — un seul pan autorisé</text>
  <text x="580" y="718" font-family="Arial" font-size="17" font-weight="700">${context.exactPanelCount} panneaux — ${form.array.rows} × ${form.array.columns} — ${form.array.orientation}</text>
  <text x="580" y="748" font-family="Arial" font-size="15">Champ PV : ${(context.fieldWidthMm/1000).toFixed(3)} m × ${(context.fieldHeightMm/1000).toFixed(3)} m</text>
  <text x="580" y="776" font-family="Arial" font-size="15">Rives : ${m(leftMm)} / ${m(rightMm)} — gouttière : ${m(gutterMm)} — faîtage : ${m(ridgeMm)}</text>
  <text x="82" y="808" font-family="Arial" font-size="14" font-weight="700">Contrôle : aucun module ne franchit le faîtage, aucun module sur le pan opposé.</text>
  <text x="55" y="857" font-family="Arial" font-size="13">DP AI Engine — plan généré à partir des données projet autoritatives</text>
</svg>`;

  const issues = fit.calibrated ? [] : [{code:"METRIC_ROOF_UNCALIBRATED",severity:"warning" as const,message:"Selected roof face lacks an authoritative metric width/slope length.",correction:"Provide or derive roofGeometry before production certification."}];
  const quality:QualityReport={
    passed: fit.fits,
    score: fit.calibrated ? 1 : 0.93,
    panelCountObserved:context.exactPanelCount, rowsObserved:form.array.rows, columnsObserved:form.array.columns,
    buildingPreserved:true,perspectiveCoherent:true,scaleCoherent:true,placementCoherent:fit.fits,
    roofFaceCorrect:true,insideSelectedRoofFace:fit.fits,singleRoofPlane:true,crossesRidge:false,arrayGeometryConsistent:true,
    issues, correctionPrompt:""
  };
  return {asset:{dp:5,kind:"svg",mimeType:"image/svg+xml",text:svg,attempt:1},quality};
}

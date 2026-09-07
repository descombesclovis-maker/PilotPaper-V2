import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildDpPdf } from "../lib/dp-pdf";
import type { ArchitecturalEvidence } from "../lib/architectural-evidence";
import { validateGeneratedPdf, validateGenerationInputs } from "../lib/generation-gate";

async function fixtureImage(kind: "satellite" | "satellite_mass" | "near" | "far") {
  const scenes = {
    satellite: `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg">
      <rect width="1600" height="1000" fill="#8bab75"/><path d="M0 90h1600v210H0z" fill="#6d747b"/>
      <path d="M0 175h1600" stroke="#ece7cf" stroke-width="10" stroke-dasharray="50 38"/>
      <rect x="320" y="410" width="900" height="390" rx="15" fill="#6f3d31" transform="rotate(-7 770 605)"/>
      <path d="M310 590L755 370l485 220-445 235z" fill="#a95e4c" stroke="#55352d" stroke-width="14"/>
      <path d="M755 370v455" stroke="#5d392f" stroke-width="12"/><circle cx="1390" cy="720" r="130" fill="#4d7748"/>
    </svg>`,
    satellite_mass: `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg">
      <rect width="1600" height="1000" fill="#86a86f"/><path d="M0 70h1600v160H0z" fill="#6d747b"/>
      <path d="M210 540L760 250l610 285-560 330z" fill="#a95e4c" stroke="#55352d" stroke-width="14"/>
      <path d="M760 250v615" stroke="#5d392f" stroke-width="12"/><circle cx="1450" cy="770" r="120" fill="#4d7748"/>
    </svg>`,
    near: `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#8fc4e8"/><stop offset="1" stop-color="#eaf2f5"/></linearGradient></defs>
      <rect width="1600" height="1000" fill="url(#sky)"/><rect y="780" width="1600" height="220" fill="#78965c"/>
      <rect x="260" y="500" width="1080" height="330" fill="#e6d5b9" stroke="#76675a" stroke-width="10"/>
      <path d="M190 520L790 180l650 340z" fill="#a35a49" stroke="#5d3931" stroke-width="16"/>
      <rect x="390" y="590" width="250" height="240" fill="#735342"/><rect x="900" y="590" width="250" height="150" fill="#739ab2" stroke="#f6f3e7" stroke-width="18"/>
    </svg>`,
    far: `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg">
      <rect width="1600" height="620" fill="#a7cfe7"/><rect y="620" width="1600" height="380" fill="#6f7378"/>
      <path d="M0 860h1600" stroke="#eee7c9" stroke-width="12" stroke-dasharray="70 55"/>
      <rect x="490" y="430" width="620" height="240" fill="#e0cfb4"/><path d="M420 450L790 245l390 205z" fill="#9d5848" stroke="#5b382f" stroke-width="12"/>
      <circle cx="250" cy="510" r="155" fill="#4c784a"/><circle cx="1320" cy="500" r="170" fill="#517d4d"/>
    </svg>`,
  } satisfies Record<string, string>;
  return new Uint8Array(await sharp(Buffer.from(scenes[kind])).png().toBuffer());
}

const sources = await Promise.all((["satellite", "satellite_mass", "near", "far"] as const).map(async (kind) => {
  const bytes = await fixtureImage(kind);
  return {
    kind,
    fileName: `${kind}-exemple-fictif.png`,
    mimeType: "image/png",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}));
if (process.env.PILOTPAPER_FIXTURE_DIR) {
  await mkdir(process.env.PILOTPAPER_FIXTURE_DIR, { recursive: true });
  await Promise.all(sources.map((source) => writeFile(
    `${process.env.PILOTPAPER_FIXTURE_DIR}/${source.kind}.png`,
    source.bytes,
  )));
}

const project = {
  id: "test-pilotpaper-generator",
  requesterKind: "person" as const,
  requesterName: "Camille Martin",
  requesterFirstName: "Camille",
  requesterLastName: "Martin",
  requesterAddress: "12 rue des Tilleuls, 21200 Beaune",
  requesterEmail: "camille.martin@example.fr",
  requesterVat: "",
  requesterSiret: "",
  requesterLegalFormCode: "",
  siteAddress: "12 rue des Tilleuls, 21200 Beaune",
  supportType: "roof",
  powerKwp: "6.0",
  moduleCount: 12,
  moduleReference: "PilotSolar PP-500M - module fictif de test",
  injectionMode: "self-surplus",
  details: {
    demoMode: "true",
    projectDescription: "EXEMPLE FICTIF - NE PAS DEPOSER EN MAIRIE. Pose de 12 modules photovoltaïques sur toiture existante.",
    birthDate: "01/01/1985",
    birthCity: "Dijon",
    birthDepartment: "21",
    birthCountry: "France",
    cadastralReference: "21054000AH0351",
    parcelAreaM2: "514",
    parcelGeometry: "{\"type\":\"Polygon\",\"coordinates\":[]}",
    municipality: "Beaune",
    roofOrientation: "Sud-est",
    roofPitchDeg: "30",
    roofColor: "Tuile terre cuite rouge",
    panelColor: "Noir mat, cadre noir",
    mountingSystem: "Surimposition parallèle au rampant",
    urbanismDocumentId: "00000000000000000000000000000000",
    urbanismDocumentType: "PLU",
    urbanismZone: "UC",
    urbanismRuleSourceUrl: "https://www.geoportail-urbanisme.gouv.fr/api/document/00000000000000000000000000000000/files/reglement-test.pdf",
    urbanismCheckedAt: new Date().toISOString(),
    urbanismAuthorityReviewRequired: "false",
    satelliteAutoGenerated: "true",
    satelliteSourceUrl: "https://data.geopf.fr/wms-r/wms?fixture=pilotpaper",
    satelliteMetersPerPixel: "0.25",
    satelliteGeneratedAt: new Date().toISOString(),
    satelliteMassSourceUrl: "https://data.geopf.fr/wms-r/wms?fixture=pilotpaper-mass",
    satelliteMassMetersPerPixel: "0.04",
    satelliteMassGeneratedAt: new Date().toISOString(),
    lawWater: "no",
    environmentalAuthorization: "no",
    protectedSpeciesDerogation: "no",
    classifiedInstallation: "no",
    otherLegislation: "no",
    heatNetworkConnection: "no",
    articleL1714: "no",
    heritageArea: "no",
    historicMonumentArea: "no",
    classifiedSite: "no",
  },
};

const inputIssues = validateGenerationInputs(project, sources, true);
if (inputIssues.length) throw new Error(`preflight:${JSON.stringify(inputIssues)}`);

const officialCerfa = new Uint8Array(await readFile(new URL("../public/forms/cerfa_16702_03.pdf", import.meta.url)));
const evidence: ArchitecturalEvidence = {
  geometry: {
    verdict: "verified",
    confidence: 0.97,
    satellite_roof_outline: [
      { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.82, y: 0.72 }, { x: 0.18, y: 0.72 },
    ],
    satellite_array_quad: [
      { x: 0.4460625, y: 0.45 }, { x: 0.5539375, y: 0.45 },
      { x: 0.5539375, y: 0.52673 }, { x: 0.4460625, y: 0.52673 },
    ],
    satellite_eave_line: [{ x: 0.2, y: 0.72 }, { x: 0.82, y: 0.72 }],
    satellite_plane_anchors: [
      { x: 0.20, y: 0.72 }, { x: 0.82, y: 0.72 }, { x: 0.80, y: 0.20 }, { x: 0.20, y: 0.20 },
    ],
    near_roof_outline: [
      { x: 0.25, y: 0.67 }, { x: 0.75, y: 0.67 }, { x: 0.70, y: 0.26 }, { x: 0.30, y: 0.26 },
    ],
    near_array_quad: [
      { x: 0.4573, y: 0.4378 }, { x: 0.5357, y: 0.4378 }, { x: 0.5357, y: 0.4990 }, { x: 0.4549, y: 0.4990 },
    ],
    near_eave_line: [{ x: 0.25, y: 0.67 }, { x: 0.75, y: 0.67 }],
    near_plane_anchors: [
      { x: 0.25, y: 0.67 }, { x: 0.75, y: 0.67 }, { x: 0.70, y: 0.26 }, { x: 0.30, y: 0.26 },
    ],
    roof_pitch_deg: 30,
    layout_rows: 2,
    layout_columns: 6,
    module_orientation: "portrait",
    agreement_iou: { satellite_roof: 0.91, satellite_array: 0.94, near_roof: 0.88, near_array: 0.9 },
    source_sha256: Object.fromEntries(sources.map((source) => [source.kind, source.sha256])),
    evidence: ["Fixture géométrique contrôlée"],
  },
  dimensions: [
    { dimension_id: "module_width", label: "Largeur module", value_mm: 1134, tolerance_mm: 1, provenance: "manufacturer_document", evidence: "Fiche fabricant contrôlée", verified: true },
    { dimension_id: "module_height", label: "Hauteur module", value_mm: 1762, tolerance_mm: 1, provenance: "manufacturer_document", evidence: "Fiche fabricant contrôlée", verified: true },
    { dimension_id: "array_width", label: "Largeur du champ", value_mm: 6904, tolerance_mm: 20, provenance: "calculated_from_verified", evidence: "Fixture", verified: true },
    { dimension_id: "array_height", label: "Hauteur du champ", value_mm: 3544, tolerance_mm: 20, provenance: "calculated_from_verified", evidence: "Fixture", verified: true },
    { dimension_id: "satellite_scale_reference", label: "Échelle satellite", value_mm: 10000, tolerance_mm: 100, provenance: "plan_scale", evidence: "Barre d’échelle contrôlée", verified: true },
  ],
};
const satelliteMass = sources.find((source) => source.kind === "satellite_mass")!;
const near = sources.find((source) => source.kind === "near")!;
const renderedSatelliteBytes = process.env.PILOTPAPER_RENDERED_SATELLITE
  ? new Uint8Array(await readFile(process.env.PILOTPAPER_RENDERED_SATELLITE))
  : satelliteMass.bytes;
const renderedNearBytes = process.env.PILOTPAPER_RENDERED_NEAR
  ? new Uint8Array(await readFile(process.env.PILOTPAPER_RENDERED_NEAR))
  : near.bytes;
const renderedViews = [
  { kind: "satellite_project" as const, mimeType: "image/png" as const, sha256: createHash("sha256").update(renderedSatelliteBytes).digest("hex"), bytes: renderedSatelliteBytes },
  { kind: "near_project" as const, mimeType: "image/png" as const, sha256: createHash("sha256").update(renderedNearBytes).digest("hex"), bytes: renderedNearBytes },
];
const pdf = await buildDpPdf(project, sources, evidence, officialCerfa, renderedViews);

const issues = await validateGeneratedPdf(pdf);
if (issues.length) throw new Error(JSON.stringify(issues));
if (process.env.PILOTPAPER_SMOKE_OUTPUT) {
  await writeFile(process.env.PILOTPAPER_SMOKE_OUTPUT, pdf);
}
console.log(`generator-smoke-ok:${pdf.byteLength}`);

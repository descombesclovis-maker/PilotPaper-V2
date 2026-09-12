"use client";

/* eslint-disable react/no-unescaped-entities */

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Crosshair,
  Download,
  FileImage,
  LoaderCircle,
  MapPinned,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { DP_PIECE_CONTRACTS, type DpPieceField } from "@/lib/dp-piece-contract";
import type { DPNumber } from "@/lib/dp-ai-engine/types";
import { RoofFaceSelector, type RoofFaceChoice } from "@/components/roof-face-selector";
import styles from "./dp-piece-workbench.module.css";

type PhotoValue = {
  role: "near" | "roof" | "far";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename: string;
};

type PieceResult = {
  dp: DPNumber;
  title: string;
  validationStatus: "test_unverified";
  mimeType: string;
  base64?: string;
  text?: string;
  sourceSummary: string[];
  inspector: { passed: boolean; score: number; checks: string[]; issues: string[] };
};

type RecoveryPoint = { x: number; y: number };
type RoofDesignerRecovery = {
  type: "roof_designer";
  reason: string;
  imageMimeType: "image/png";
  imageBase64: string;
  widthPx: number;
  heightPx: number;
};
type ManualRoofPayload = {
  quadNormalized: RecoveryPoint[];
  slopeDeg: number;
  keepouts: Array<{ id: string; type: string; polygonNormalized: RecoveryPoint[] }>;
  obstaclesConfirmed: true;
};
type ApiFailure = { error?: string; recovery?: RoofDesignerRecovery; validationStatus?: "test_unverified" };

type RoofFaceMap = {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  normalizedAddress?: string;
  parcelReference?: string;
  buildingId?: string;
  imageryQuality?: string;
  configuration?: {
    moduleReference: string;
    panelCount: number;
    rows: number;
    columns: number;
    orientation: "portrait" | "landscape";
  };
  faces: RoofFaceChoice[];
};

type Draft = {
  address: string;
  moduleReference: string;
  panelCount: string;
  rows: string;
  columns: string;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  roofFace: string;
  roofWidthMm: string;
  roofSlopeLengthMm: string;
  roofSlopeDeg: string;
  gutterClearanceMm: string;
  interPanelGapMm: string;
};

const defaultDraft: Draft = {
  address: "",
  moduleReference: "TSM-450NEG9R.28",
  panelCount: "12",
  rows: "2",
  columns: "6",
  orientation: "portrait",
  placement: "centered",
  roofFace: "",
  roofWidthMm: "7900",
  roofSlopeLengthMm: "4220",
  roofSlopeDeg: "30",
  gutterClearanceMm: "300",
  interPanelGapMm: "20",
};

const modules = [
  ["TSM-450NEG9R.28", "Trina Solar · Vertex S+ · 450 W"],
  ["JKM440N-54HL4R-B", "JinkoSolar · Tiger Neo · 440 W"],
  ["DS500-120M10TB-03", "DualSun · FLASH TOPCon · 500 W"],
  ["DS500-132M10-01", "DualSun · FLASH Black · 500 W"],
] as const;

const fieldLabels: Record<DpPieceField, { label: string; hint?: string }> = {
  address: { label: "Adresse exacte du projet", hint: "L'adresse verrouille la parcelle cadastrale et le bâtiment cible avant toute analyse de toiture." },
  parcelReference: { label: "Référence cadastrale" },
  moduleReference: { label: "Module photovoltaïque", hint: "Dimensions et puissance viennent du catalogue fabricant vérifié." },
  panelCount: { label: "Nombre de modules" },
  rows: { label: "Rangées" },
  columns: { label: "Colonnes" },
  orientation: { label: "Orientation des modules" },
  placement: { label: "Placement du champ" },
  roofFace: { label: "Pan ciblé" },
  roofWidthMm: { label: "Largeur réelle du pan (mm)", hint: "Mesure fiable uniquement : plan, relevé ou cote connue." },
  roofSlopeLengthMm: { label: "Longueur réelle du rampant (mm)", hint: "Distance gouttière → faîtage sur le plan du toit." },
  roofSlopeDeg: { label: "Pente du toit (°)" },
  gutterClearanceMm: { label: "Recul bas préféré (mm)", hint: "300 mm est une préférence ; le moteur peut le réduire si le calepinage l'exige." },
  interPanelGapMm: { label: "Jeu entre modules (mm)" },
  nearPhoto: { label: "Vue proche", hint: "Maison et toiture lisibles." },
  roofPhoto: { label: "Vue oblique toiture", hint: "Doit permettre de lire rives, gouttière, faîtage, perspective et obstacles." },
  farPhoto: { label: "Vue lointaine", hint: "Maison replacée dans son environnement." },
};

const ROOF_ANALYSIS_KEYS: Array<keyof Draft> = [
  "address",
  "moduleReference",
  "panelCount",
  "rows",
  "columns",
  "orientation",
  "placement",
  "interPanelGapMm",
];

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function initialDraft(): Draft {
  try {
    const saved = localStorage.getItem("pilotpaper-v1-k-par-k-draft");
    if (!saved) return defaultDraft;
    return { ...defaultDraft, ...JSON.parse(saved), roofFace: "" } as Draft;
  } catch {
    return defaultDraft;
  }
}

function initialHistory(): Partial<Record<DPNumber, { tests: number; lastPassed: boolean }>> {
  try {
    const saved = localStorage.getItem("pilotpaper-v1-k-par-k-history");
    return saved ? JSON.parse(saved) as Partial<Record<DPNumber, { tests: number; lastPassed: boolean }>> : {};
  } catch {
    return {};
  }
}

async function fileToPhoto(file: File, role: PhotoValue["role"]): Promise<PhotoValue> {
  if (file.size > 18 * 1024 * 1024) throw new Error("Photo trop lourde : 18 Mo maximum pour l'atelier V1.");
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Format photo non pris en charge ici : utilisez JPEG, PNG ou WebP.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(",")[1] ?? "";
  if (base64.length < 1000) throw new Error("Photo vide ou illisible.");
  return { role, mimeType: file.type as PhotoValue["mimeType"], base64, filename: file.name };
}

export function DpPieceWorkbench() {
  const [selectedDp, setSelectedDp] = useState<DPNumber | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [photos, setPhotos] = useState<Partial<Record<PhotoValue["role"], PhotoValue>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PieceResult | null>(null);
  const [recovery, setRecovery] = useState<RoofDesignerRecovery | null>(null);
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryPoint[]>([]);
  const [designerMode, setDesignerMode] = useState<"roof" | "obstacle">("roof");
  const [obstacleDraftPoints, setObstacleDraftPoints] = useState<RecoveryPoint[]>([]);
  const [keepoutPolygons, setKeepoutPolygons] = useState<RecoveryPoint[][]>([]);
  const [noObstaclesConfirmed, setNoObstaclesConfirmed] = useState(false);
  const [history, setHistory] = useState<Partial<Record<DPNumber, { tests: number; lastPassed: boolean }>>>(initialHistory);
  const [roofFaceMap, setRoofFaceMap] = useState<RoofFaceMap | null>(null);
  const [roofFaceMapState, setRoofFaceMapState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [roofFaceMapError, setRoofFaceMapError] = useState("");

  const contract = useMemo(() => DP_PIECE_CONTRACTS.find((piece) => piece.dp === selectedDp) ?? null, [selectedDp]);
  const requiresRoofFace = Boolean(contract?.fields.includes("roofFace"));
  const previewUrl = useMemo(() => {
    if (!result) return "";
    if (result.text) return `data:${result.mimeType};charset=utf-8,${encodeURIComponent(result.text)}`;
    if (result.base64) return `data:${result.mimeType};base64,${result.base64}`;
    return "";
  }, [result]);

  const configurationReady = useMemo(() => {
    const panelCount = positiveInteger(draft.panelCount);
    const rows = positiveInteger(draft.rows);
    const columns = positiveInteger(draft.columns);
    return Boolean(
      draft.address.trim().length >= 8
      && draft.moduleReference
      && panelCount
      && rows
      && columns
      && rows * columns === panelCount,
    );
  }, [draft.address, draft.moduleReference, draft.panelCount, draft.rows, draft.columns]);

  const roofAnalysisSignature = useMemo(() => [
    draft.address.trim(),
    draft.moduleReference,
    draft.panelCount,
    draft.rows,
    draft.columns,
    draft.orientation,
    draft.placement,
    draft.interPanelGapMm,
  ].join("|"), [
    draft.address,
    draft.moduleReference,
    draft.panelCount,
    draft.rows,
    draft.columns,
    draft.orientation,
    draft.placement,
    draft.interPanelGapMm,
  ]);

  useEffect(() => {
    try { localStorage.setItem("pilotpaper-v1-k-par-k-draft", JSON.stringify(draft)); } catch { /* ignore */ }
  }, [draft]);

  const loadRoofFaces = useCallback(async (snapshot: Draft) => {
    const cleanAddress = snapshot.address.trim();
    const panelCount = positiveInteger(snapshot.panelCount);
    const rows = positiveInteger(snapshot.rows);
    const columns = positiveInteger(snapshot.columns);
    if (cleanAddress.length < 8 || !panelCount || !rows || !columns || rows * columns !== panelCount) return;

    setRoofFaceMapState("loading");
    setRoofFaceMapError("");
    setRoofFaceMap(null);
    setDraft((current) => ({ ...current, roofFace: "" }));
    try {
      const response = await fetch("/api/dp-piece/roof-faces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: cleanAddress,
          moduleReference: snapshot.moduleReference,
          panelCount,
          rows,
          columns,
          orientation: snapshot.orientation,
          placement: snapshot.placement,
          gutterClearanceMm: numeric(snapshot.gutterClearanceMm),
          interPanelGapMm: numeric(snapshot.interPanelGapMm),
        }),
      });
      const body = await response.json().catch(() => null) as (RoofFaceMap & { error?: string }) | null;
      if (!response.ok || !body?.faces?.length || !body.imageDataUrl) {
        throw new Error(body?.error || "Aucun pan compatible n'a pu être démontré sur le bâtiment cible.");
      }
      setRoofFaceMap(body);
      setRoofFaceMapState("ready");
    } catch (mapError) {
      setRoofFaceMapState("error");
      setRoofFaceMapError(mapError instanceof Error ? mapError.message : "L'analyse automatique de la toiture a échoué.");
    }
  }, []);

  useEffect(() => {
    if (!requiresRoofFace || !configurationReady) return;
    const snapshot = { ...draft };
    const timer = window.setTimeout(() => { void loadRoofFaces(snapshot); }, 700);
    return () => window.clearTimeout(timer);
    // roofAnalysisSignature intentionally contains every configuration value that changes eligibility.
  }, [requiresRoofFace, configurationReady, roofAnalysisSignature, loadRoofFaces]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    const affectsRoofAnalysis = ROOF_ANALYSIS_KEYS.includes(key);
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(affectsRoofAnalysis ? { roofFace: "" } : {}),
    }));
    if (affectsRoofAnalysis) {
      setResult(null);
      setRoofFaceMap(null);
      setRoofFaceMapState("idle");
      setRoofFaceMapError("");
      setError("");
    }
  }

  function clearRecovery() {
    setRecovery(null);
    setRecoveryPoints([]);
    setDesignerMode("roof");
    setObstacleDraftPoints([]);
    setKeepoutPolygons([]);
    setNoObstaclesConfirmed(false);
  }

  function openPiece(dp: DPNumber) {
    setSelectedDp(dp);
    setResult(null);
    setError("");
    setDraft((current) => ({ ...current, roofFace: "" }));
    setRoofFaceMap(null);
    setRoofFaceMapState("idle");
    setRoofFaceMapError("");
    clearRecovery();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetPiece() {
    setResult(null);
    setError("");
    setPhotos({});
    setDraft((current) => ({ ...current, roofFace: "" }));
    setRoofFaceMap(null);
    setRoofFaceMapState("idle");
    setRoofFaceMapError("");
    clearRecovery();
  }

  async function setPhoto(role: PhotoValue["role"], file?: File) {
    if (!file) return;
    try {
      const value = await fileToPhoto(file, role);
      setPhotos((current) => ({ ...current, [role]: value }));
      setError("");
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Photo invalide.");
    }
  }

  async function generate(manualRoofDesign?: ManualRoofPayload) {
    if (!contract) return;
    if (requiresRoofFace && !draft.roofFace && !manualRoofDesign) {
      setError("Choisissez d'abord l'un des pans compatibles proposés dans RÉSULTAT.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    if (!manualRoofDesign) clearRecovery();
    try {
      const payload = {
        dp: contract.dp,
        address: draft.address,
        moduleReference: draft.moduleReference,
        panelCount: numeric(draft.panelCount),
        rows: numeric(draft.rows),
        columns: numeric(draft.columns),
        orientation: draft.orientation,
        placement: draft.placement,
        roofFace: draft.roofFace,
        roofWidthMm: numeric(draft.roofWidthMm),
        roofSlopeLengthMm: numeric(draft.roofSlopeLengthMm),
        roofSlopeDeg: numeric(draft.roofSlopeDeg),
        gutterClearanceMm: numeric(draft.gutterClearanceMm),
        interPanelGapMm: numeric(draft.interPanelGapMm),
        photos: Object.values(photos),
        ...(manualRoofDesign ? { manualRoofDesign } : {}),
      };
      const response = await fetch("/api/dp-piece", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as PieceResult | ApiFailure | null;
      if (!response.ok || !body || !("dp" in body)) {
        const failure = body && !("dp" in body) ? body : null;
        if (response.status === 409 && failure?.recovery?.type === "roof_designer") {
          setRecovery(failure.recovery);
          setRecoveryPoints([]);
          setDesignerMode("roof");
          setObstacleDraftPoints([]);
          setKeepoutPolygons([]);
          setNoObstaclesConfirmed(false);
          return;
        }
        throw new Error(failure?.error || `Génération impossible (${response.status}).`);
      }
      clearRecovery();
      setResult(body);
      setHistory((current) => {
        const previous = current[contract.dp];
        const next = { ...current, [contract.dp]: { tests: (previous?.tests ?? 0) + 1, lastPassed: body.inspector.passed } };
        try { localStorage.setItem("pilotpaper-v1-k-par-k-history", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "La génération a échoué.");
    } finally {
      setBusy(false);
    }
  }

  function addRecoveryPoint(event: MouseEvent<HTMLDivElement>) {
    if (!recovery || busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    if (designerMode === "roof") {
      if (recoveryPoints.length >= 4) return;
      setRecoveryPoints((current) => [...current, point].slice(0, 4));
      return;
    }
    const next = [...obstacleDraftPoints, point].slice(0, 4);
    if (next.length === 4) {
      setKeepoutPolygons((current) => [...current, next]);
      setObstacleDraftPoints([]);
      setDesignerMode("roof");
      setNoObstaclesConfirmed(false);
    } else {
      setObstacleDraftPoints(next);
    }
  }

  function submitRoofDesigner() {
    const slopeDeg = numeric(draft.roofSlopeDeg);
    if (recoveryPoints.length !== 4 || slopeDeg == null || slopeDeg < 0 || slopeDeg > 75) return;
    if (!noObstaclesConfirmed && keepoutPolygons.length === 0) return;
    const manualRoofDesign: ManualRoofPayload = {
      quadNormalized: recoveryPoints,
      slopeDeg,
      keepouts: keepoutPolygons.map((polygonNormalized, index) => ({ id: `K${index + 1}`, type: "manual_keepout", polygonNormalized })),
      obstaclesConfirmed: true,
    };
    void generate(manualRoofDesign);
  }

  function downloadResult() {
    if (!result || !previewUrl) return;
    const extension = result.mimeType.includes("svg") ? "svg" : result.mimeType.includes("png") ? "png" : "jpg";
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = `PilotPaper-V1-DP${result.dp}-TEST.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function inputField(field: DpPieceField) {
    if (field === "roofFace") return null;
    const meta = fieldLabels[field];
    if (["nearPhoto", "roofPhoto", "farPhoto"].includes(field)) {
      const role = field === "nearPhoto" ? "near" : field === "roofPhoto" ? "roof" : "far";
      const photo = photos[role];
      return (
        <label className={styles.photoField} key={field}>
          <span className={styles.fieldTitle}>{meta.label}</span>
          <span className={styles.fieldHint}>{meta.hint}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void setPhoto(role, event.target.files?.[0])} />
          <span className={photo ? styles.photoReady : styles.photoEmpty}><FileImage size={17} /> {photo ? photo.filename : "Choisir une photo"}</span>
        </label>
      );
    }
    if (field === "moduleReference") {
      return (
        <label className={styles.field} key={field}>
          <span className={styles.fieldTitle}>{meta.label}</span><span className={styles.fieldHint}>{meta.hint}</span>
          <select value={draft.moduleReference} onChange={(event) => update("moduleReference", event.target.value)}>
            {modules.map(([reference, label]) => <option key={reference} value={reference}>{label} · {reference}</option>)}
          </select>
        </label>
      );
    }
    if (field === "orientation") {
      return <label className={styles.field} key={field}><span className={styles.fieldTitle}>{meta.label}</span><select value={draft.orientation} onChange={(event) => update("orientation", event.target.value as Draft["orientation"])}><option value="portrait">Portrait</option><option value="landscape">Paysage</option></select></label>;
    }
    if (field === "placement") {
      return <label className={styles.field} key={field}><span className={styles.fieldTitle}>{meta.label}</span><select value={draft.placement} onChange={(event) => update("placement", event.target.value as Draft["placement"])}><option value="centered">Centré</option><option value="left">Aligné à gauche</option><option value="right">Aligné à droite</option><option value="custom">Personnalisé</option></select></label>;
    }
    const draftKey = field as keyof Draft;
    const isNumber = ["panelCount", "rows", "columns", "roofWidthMm", "roofSlopeLengthMm", "roofSlopeDeg", "gutterClearanceMm", "interPanelGapMm"].includes(field);
    return (
      <label className={`${styles.field} ${field === "address" ? styles.wide : ""}`} key={field}>
        <span className={styles.fieldTitle}>{meta.label}</span>{meta.hint ? <span className={styles.fieldHint}>{meta.hint}</span> : null}
        <input type={isNumber ? "number" : "text"} min={isNumber ? 0 : undefined} value={String(draft[draftKey] ?? "")} onChange={(event) => update(draftKey, event.target.value as never)} placeholder={field === "address" ? "Ex. 2 Hameau du Chêne, 71260 Senozan" : undefined} />
      </label>
    );
  }

  if (!contract) {
    return (
      <main className={styles.app}>
        <header className={styles.topbar}>
          <div className={styles.brand}><img src="/pilotpaper-dp.svg" alt="dP" /><div><strong>PilotPaper</strong><span>V1 · Atelier de validation</span></div></div>
          <div className={styles.testBadge}><span /> MODE TEST · NON VALIDÉ</div>
        </header>
        <section className={styles.hero}>
          <div><span className={styles.eyebrow}>VALIDATION K-PAR-K</span><h1>Une pièce. Un formulaire.<br />Un résultat à contrôler.</h1><p>On fiabilise DP1 à DP8 séparément avant de reconstruire le dossier automatique complet. Chaque défaut observé devient une règle générale et un test de régression.</p></div>
          <div className={styles.heroStatus}><ShieldCheck size={28} /><strong>Architecture V1 contrôlée</strong><span>Parcelle → Bâtiment → Toiture → Layout → Projection → Inspector</span></div>
        </section>
        <section className={styles.grid}>
          {DP_PIECE_CONTRACTS.map((piece) => {
            const state = history[piece.dp];
            return (
              <button className={styles.pieceCard} key={piece.dp} onClick={() => openPiece(piece.dp)}>
                <div className={styles.cardTop}><span className={styles.dpNumber}>DP{piece.dp}</span>{state ? <span className={state.lastPassed ? styles.passDot : styles.failDot}>{state.tests} test{state.tests > 1 ? "s" : ""}</span> : <span className={styles.newDot}>À tester</span>}</div>
                <h2>{piece.title}</h2><p>{piece.purpose}</p>
                <div className={styles.pipelineTags}>{piece.usesRoofUnderstanding ? <span>Roof</span> : null}{piece.usesLayout ? <span>Layout</span> : null}{piece.usesProjection ? <span>Projection</span> : null}{piece.usesPhotorealisticRender ? <span>Render IA</span> : null}{piece.usesInspector ? <span>Inspector</span> : null}</div>
                <span className={styles.openLabel}>Ouvrir l'atelier →</span>
              </button>
            );
          })}
        </section>
      </main>
    );
  }

  const slopeReady = numeric(draft.roofSlopeDeg) != null && Number(draft.roofSlopeDeg) >= 0 && Number(draft.roofSlopeDeg) <= 75;
  const obstacleReviewReady = noObstaclesConfirmed || keepoutPolygons.length > 0;
  const faceReady = !requiresRoofFace || Boolean(draft.roofFace);

  return (
    <main className={styles.app}>
      <header className={styles.topbar}>
        <button className={styles.back} onClick={() => setSelectedDp(null)}><ArrowLeft size={18} /> Toutes les pièces</button>
        <div className={styles.brandCompact}><img src="/pilotpaper-dp.svg" alt="dP" /><strong>PilotPaper V1</strong></div>
        <div className={styles.testBadge}><span /> TEST · NON VALIDÉ</div>
      </header>

      <section className={styles.workspaceHeader}>
        <div className={styles.dpHeroNumber}>DP{contract.dp}</div>
        <div><span className={styles.eyebrow}>ATELIER ISOLÉ</span><h1>{contract.title}</h1><p>{contract.purpose}</p></div>
        <button className={styles.reset} onClick={resetPiece}><RotateCcw size={16} /> Nouveau test</button>
      </section>

      <div className={styles.workspace}>
        <section className={styles.formPanel}>
          <div className={styles.panelHeading}><div><span>FORMULAIRE DP{contract.dp}</span><h2>Uniquement les données nécessaires</h2></div><MapPinned size={24} /></div>
          <div className={styles.formGrid}>{contract.fields.map(inputField)}</div>
          {requiresRoofFace && draft.address.trim().length >= 8 && !configurationReady ? (
            <div className={styles.error}><TriangleAlert size={19} /><span>Complétez une configuration cohérente : nombre de panneaux = rangées × colonnes. Les pans seront analysés ensuite.</span></div>
          ) : null}
          {error ? <div className={styles.error}><TriangleAlert size={19} /><span>{error}</span></div> : null}

          {recovery ? (
            <div className={styles.recoveryCard}>
              <div className={styles.recoveryHeading}><Crosshair size={20} /><div><strong>Roof Designer · recours manuel</strong><span>{recoveryPoints.length}/4 coins du pan · {keepoutPolygons.length} keepout(s)</span></div></div>
              <p><strong>Dernier recours uniquement.</strong> Les sources automatiques ont été tentées avant d'ouvrir cet outil. Tu définis la géométrie visible ; PilotPaper conserve l'échelle IGN et relance ensuite le Layout Engine.</p>
              <div className={styles.recoveryReason}>{recovery.reason}</div>
              <div className={styles.designerGuide}><span>1 · Gouttière gauche</span><span>2 · Gouttière droite</span><span>3 · Faîtage droite</span><span>4 · Faîtage gauche</span></div>
              <div className={styles.recoveryImageWrap} onClick={addRecoveryPoint} role="button" tabIndex={0} aria-label="Roof Designer">
                <img src={`data:${recovery.imageMimeType};base64,${recovery.imageBase64}`} alt="Orthophoto IGN métrée pour Roof Designer" />
                <svg className={styles.recoveryOverlay} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                  {recoveryPoints.length >= 2 ? <polyline points={recoveryPoints.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} fill="none" stroke="white" strokeWidth="5" strokeDasharray="12 8" /> : null}
                  {recoveryPoints.length === 4 ? <polygon points={recoveryPoints.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} fill="rgba(23,59,103,.20)" stroke="#ffffff" strokeWidth="5" /> : null}
                  {keepoutPolygons.map((polygon, polygonIndex) => <polygon key={`keepout-${polygonIndex}`} points={polygon.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} fill="rgba(214,107,62,.30)" stroke="#d66b3e" strokeWidth="6" />)}
                  {designerMode === "obstacle" && obstacleDraftPoints.length >= 2 ? <polyline points={obstacleDraftPoints.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} fill="none" stroke="#d66b3e" strokeWidth="6" strokeDasharray="12 8" /> : null}
                  {recoveryPoints.map((point, index) => <g key={`${point.x}-${point.y}-${index}`}><circle cx={point.x * 1000} cy={point.y * 1000} r="16" fill="#173b67" stroke="#fff" strokeWidth="6" /><text x={point.x * 1000} y={point.y * 1000 + 6} textAnchor="middle" fontSize="18" fontWeight="900" fill="#fff">{index + 1}</text></g>)}
                  {obstacleDraftPoints.map((point, index) => <circle key={`obstacle-draft-${index}`} cx={point.x * 1000} cy={point.y * 1000} r="13" fill="#d66b3e" stroke="#fff" strokeWidth="5" />)}
                </svg>
              </div>
              <div className={styles.designerControls}>
                <label><span>Pente du pan (°)</span><input type="number" min="0" max="75" step="0.5" value={draft.roofSlopeDeg} onChange={(event) => update("roofSlopeDeg", event.target.value)} /></label>
                <div className={styles.keepoutControls}>
                  <button type="button" onClick={() => { setRecoveryPoints([]); setDesignerMode("roof"); setObstacleDraftPoints([]); }} disabled={busy}>Refaire le pan</button>
                  <button type="button" onClick={() => { setDesignerMode("obstacle"); setObstacleDraftPoints([]); setNoObstaclesConfirmed(false); }} disabled={busy || recoveryPoints.length !== 4}>{designerMode === "obstacle" ? "Clique 4 coins de l'obstacle…" : "Ajouter un obstacle"}</button>
                  <button type="button" onClick={() => { setKeepoutPolygons((current) => current.slice(0, -1)); setNoObstaclesConfirmed(false); }} disabled={busy || keepoutPolygons.length === 0}>Retirer dernier obstacle</button>
                </div>
                <label className={styles.noObstacleCheck}><input type="checkbox" checked={noObstaclesConfirmed} disabled={keepoutPolygons.length > 0} onChange={(event) => setNoObstaclesConfirmed(event.target.checked)} /><span>Je confirme qu'il n'y a aucun obstacle/zone interdite sur ce pan.</span></label>
                {keepoutPolygons.length > 0 ? <div className={styles.keepoutStatus}>✓ {keepoutPolygons.length} obstacle(s) / keepout(s) tracé(s). Ils seront interdits au Layout Engine.</div> : null}
              </div>
              <button type="button" className={styles.recoveryConfirmWide} onClick={submitRoofDesigner} disabled={busy || recoveryPoints.length !== 4 || !slopeReady || !obstacleReviewReady || designerMode === "obstacle"}>
                {busy ? <><LoaderCircle className={styles.spin} size={17} /> Calcul du calepinage…</> : <>Valider le toit et relancer DP2</>}
              </button>
            </div>
          ) : (
            <button className={styles.generate} disabled={busy || !faceReady} onClick={() => void generate()}>
              {busy ? <><LoaderCircle className={styles.spin} size={19} /> Génération DP{contract.dp}…</> : !faceReady ? <>Sélectionnez un pan compatible dans RÉSULTAT</> : <>Générer DP{contract.dp} <span>TEST</span></>}
            </button>
          )}
          <p className={styles.modeNote}>Cette V1 ne peut produire qu'un résultat <strong>test_unverified</strong>. Aucun clic ne peut le transformer en document de production.</p>
        </section>

        <section className={styles.previewPanel}>
          <div className={styles.panelHeading}>
            <div><span>RÉSULTAT</span><h2>{requiresRoofFace && !result ? "Analyse du bâtiment et des pans compatibles" : "Contrôle visuel"}</h2></div>
            {result ? <button className={styles.download} onClick={downloadResult}><Download size={16} /> Exporter</button> : null}
          </div>

          {result ? (
            <>
              <div className={styles.previewCanvas}>{previewUrl ? <img src={previewUrl} alt={`Résultat DP${contract.dp}`} /> : null}</div>
              <div className={result.inspector.passed ? styles.inspectorPass : styles.inspectorFail}>
                <div className={styles.inspectorTitle}>{result.inspector.passed ? <CheckCircle2 size={20} /> : <TriangleAlert size={20} />}<strong>PilotPaper Inspector</strong><span>{Math.round(result.inspector.score * 100)} %</span></div>
                {result.inspector.checks.map((check) => <p key={check}>✓ {check}</p>)}
                {result.inspector.issues.map((issue) => <p key={issue}>⚠ {issue}</p>)}
              </div>
              <div className={styles.sources}><strong>Sources utilisées</strong>{result.sourceSummary.map((source) => <span key={source}>{source}</span>)}</div>
            </>
          ) : requiresRoofFace ? (
            <div className="space-y-4 p-5">
              {draft.address.trim().length < 8 ? (
                <div className={styles.emptyPreview}><img src="/pilotpaper-france-map.svg" alt="Carte de France" /><strong>Localisez d'abord le projet</strong><span>Entrez l'adresse exacte. PilotPaper identifiera ensuite la parcelle et uniquement le bâtiment concerné.</span></div>
              ) : !configurationReady ? (
                <div className={styles.emptyPreview}><MapPinned size={34} /><strong>Adresse reçue · configuration à compléter</strong><span>Choisissez le module, le nombre de panneaux, les rangées, colonnes et l'orientation. L'analyse des pans se fera uniquement pour cette configuration.</span></div>
              ) : roofFaceMapState === "loading" ? (
                <div className={styles.emptyPreview}><LoaderCircle className={styles.spin} size={34} /><strong>Analyse du bâtiment cible…</strong><span>Parcelle cadastrale → bâtiment BD TOPO → pans Google Solar → test du calepinage → validation DP3.</span></div>
              ) : roofFaceMapState === "error" ? (
                <div className={styles.emptyPreview}><TriangleAlert size={34} /><strong>Analyse automatique indisponible</strong><span>{roofFaceMapError}</span><button type="button" className={styles.download} onClick={() => void loadRoofFaces({ ...draft })}>Réessayer l'analyse automatique</button></div>
              ) : roofFaceMap ? (
                <>
                  <RoofFaceSelector
                    imageUrl={roofFaceMap.imageDataUrl}
                    faces={roofFaceMap.faces}
                    selectedFaceIds={draft.roofFace ? [draft.roofFace] : []}
                    onChange={(faceIds) => {
                      const next = faceIds.at(-1) ?? "";
                      setDraft((current) => ({ ...current, roofFace: next }));
                      setError("");
                      setResult(null);
                    }}
                    disabled={busy}
                  />
                  {draft.roofFace ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Pan {draft.roofFace} sélectionné. Ce pan a déjà passé le contrôle du bâtiment cible, du calepinage demandé et de la coupe DP3.</div>
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Seuls les pans capables d'accueillir cette configuration sont affichés. Choisissez celui à équiper.</div>
                  )}
                  <div className="flex items-center justify-between gap-3 text-xs text-zinc-500"><span>{roofFaceMap.parcelReference ? `Parcelle ${roofFaceMap.parcelReference}` : "Parcelle identifiée"}{roofFaceMap.buildingId ? ` · bâtiment ${roofFaceMap.buildingId}` : ""}</span><button type="button" className="underline underline-offset-4" onClick={() => void loadRoofFaces({ ...draft })} disabled={busy}>Réanalyser</button></div>
                </>
              ) : (
                <div className={styles.emptyPreview}><LoaderCircle className={styles.spin} size={30} /><strong>Préparation de l'analyse</strong><span>PilotPaper attend la configuration complète.</span></div>
              )}
            </div>
          ) : (
            <div className={styles.emptyPreview}><img src="/pilotpaper-dp.svg" alt="" /><strong>{recovery ? "Roof Designer attend ta validation" : `DP${contract.dp} en attente`}</strong><span>{recovery ? "Le recours manuel n'est utilisé qu'après échec de toutes les sources automatiques." : "Le résultat apparaîtra ici sans ouvrir de nouvelle fenêtre."}</span></div>
          )}
        </section>
      </div>
    </main>
  );
}

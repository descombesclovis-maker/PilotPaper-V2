"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Layers3,
  LoaderCircle,
  MapPin,
  Maximize2,
  RotateCcw,
  Sparkles,
  SunMedium,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import type { DPNumber, DpPieceOutput, PiecePhotoInput, VisualReference } from "@/lib/pilotpaper-image2-types";
import { deletePersistedDpPiece, persistDpPiece } from "@/lib/pilotpaper-image2-persistence";
import { BRANDING_STORAGE_KEY, DEFAULT_BRANDING, INSTALLATION_PREFS_STORAGE_KEY, type PilotPaperBranding } from "./pilotpaper-production-shell";
import styles from "./complete-dp-experience.module.css";

type PhotoValue = PiecePhotoInput & { previewUrl: string };
type PieceStatus = "idle" | "running" | "done" | "error";
type PieceState = { status: PieceStatus; result?: DpPieceOutput; error?: string };
type PieceStates = Record<DPNumber, PieceState>;
type InstallationPreferences = {
  moduleReference?: string;
  rows?: string;
  columns?: string;
  orientation?: "portrait" | "landscape";
  placement?: "centered" | "left" | "right" | "custom";
  panelGapMm?: string;
  gutterClearanceMm?: string;
};

type ProjectDraft = {
  address: string;
  moduleReference: string;
  panelCount: number;
  rows: number;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  panelGapMm: number;
  gutterClearanceMm: number;
};

const DRAFT_KEY = "pilotpaper-complete-dp-draft";
const DEFAULT_DRAFT: ProjectDraft = {
  address: "",
  moduleReference: "TSM-450NEG9R.28",
  panelCount: 12,
  rows: 2,
  orientation: "portrait",
  placement: "centered",
  panelGapMm: 20,
  gutterClearanceMm: 300,
};

const MODULES = [
  ["TSM-450NEG9R.28", "Trina Solar · Vertex S+ · 450 W"],
  ["JKM440N-54HL4R-B", "JinkoSolar · Tiger Neo · 440 W"],
  ["DS500-120M10TB-03", "DualSun · FLASH TOPCon · 500 W"],
  ["DS500-132M10-01", "DualSun · FLASH Black · 500 W"],
] as const;

const PIECES: Array<{ dp: DPNumber; title: string; short: string }> = [
  { dp: 1, title: "Plan de situation", short: "Situation" },
  { dp: 2, title: "Plan de masse", short: "Masse" },
  { dp: 3, title: "Plan en coupe", short: "Coupe" },
  { dp: 4, title: "État initial / projeté", short: "Avant / après" },
  { dp: 5, title: "Aspect extérieur", short: "Vue rapprochée" },
  { dp: 6, title: "Insertion du projet", short: "Insertion" },
  { dp: 7, title: "Environnement proche", short: "Photo proche" },
  { dp: 8, title: "Paysage lointain", short: "Photo lointaine" },
];

function blankPieceStates(): PieceStates {
  return Object.fromEntries(PIECES.map(({ dp }) => [dp, { status: "idle" }])) as PieceStates;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function initialDraftFromStorage(): ProjectDraft {
  const prefs = readJson<InstallationPreferences>(INSTALLATION_PREFS_STORAGE_KEY, {});
  const rows = Math.max(1, Number(prefs.rows || DEFAULT_DRAFT.rows));
  const columns = Math.max(1, Number(prefs.columns || 6));
  const fromPrefs: ProjectDraft = {
    ...DEFAULT_DRAFT,
    moduleReference: prefs.moduleReference || DEFAULT_DRAFT.moduleReference,
    panelCount: rows * columns,
    rows,
    orientation: prefs.orientation || DEFAULT_DRAFT.orientation,
    placement: prefs.placement || DEFAULT_DRAFT.placement,
    panelGapMm: Math.max(0, Number(prefs.panelGapMm || DEFAULT_DRAFT.panelGapMm)),
    gutterClearanceMm: Math.max(0, Number(prefs.gutterClearanceMm || DEFAULT_DRAFT.gutterClearanceMm)),
  };
  return readJson<ProjectDraft>(DRAFT_KEY, fromPrefs);
}

function base64FromDataUrl(dataUrl: string) {
  return dataUrl.split(",")[1] ?? "";
}

async function optimizePhoto(file: File, role: "near" | "far"): Promise<PhotoValue> {
  if (!file.type.startsWith("image/")) throw new Error("Utilisez une image JPEG, PNG ou WebP.");
  if (file.size > 20 * 1024 * 1024) throw new Error("La photo dépasse 20 Mo.");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("Cette photo ne peut pas être lue."));
      node.src = sourceUrl;
    });
    const maxSide = 2400;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Préparation de la photo impossible.");
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.93);
    return {
      role,
      mimeType: "image/jpeg",
      base64: base64FromDataUrl(dataUrl),
      filename: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function referencesFor(dp: DPNumber, results: Partial<Record<DPNumber, DpPieceOutput>>): VisualReference[] {
  const order: Partial<Record<DPNumber, Array<2 | 3 | 4 | 5>>> = {
    3: [2],
    4: [2, 3],
    5: [4, 2, 3],
    6: [5, 4, 2],
  };
  return (order[dp] ?? []).flatMap((referenceDp) => {
    const candidate = results[referenceDp];
    if (!candidate?.base64 || !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(candidate.mimeType)) return [];
    return [{
      dp: referenceDp,
      mimeType: candidate.mimeType as VisualReference["mimeType"],
      base64: candidate.base64,
      geometryReceipt: candidate.geometryReceipt,
    }];
  });
}

function hexToRgb(hex: string) {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "102a56";
  return rgb(
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  );
}

function base64Bytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pdfSafe(value: string) {
  return value
    .replace(/[→⇒]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\u00C0-\u00FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function pngDataUrlFromImageDataUrl(dataUrl: string) {
  if (!dataUrl) return "";
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error("Image illisible"));
    node.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  const maxWidth = 500;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function buildCompletePdf(
  results: Partial<Record<DPNumber, DpPieceOutput>>,
  draft: ProjectDraft,
  branding: PilotPaperBranding,
) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primary = hexToRgb(branding.primaryColor || DEFAULT_BRANDING.primaryColor);
  const accent = hexToRgb(branding.accentColor || DEFAULT_BRANDING.accentColor);
  const paper = hexToRgb(branding.paperColor || DEFAULT_BRANDING.paperColor);
  let logo: PDFImage | null = null;

  if (branding.logoDataUrl) {
    try {
      const normalized = await pngDataUrlFromImageDataUrl(branding.logoDataUrl);
      if (normalized) logo = await pdf.embedPng(base64Bytes(base64FromDataUrl(normalized)));
    } catch {
      logo = null;
    }
  }

  const cover = pdf.addPage([841.89, 595.28]);
  cover.drawRectangle({ x: 0, y: 0, width: 841.89, height: 595.28, color: paper });
  cover.drawRectangle({ x: 0, y: 0, width: 23, height: 595.28, color: primary });
  cover.drawRectangle({ x: 23, y: 0, width: 7, height: 595.28, color: accent });
  cover.drawText("PILOTPAPER", { x: 70, y: 510, size: 11, font: bold, color: primary });
  cover.drawText("DECLARATION PREALABLE", { x: 70, y: 433, size: 34, font: bold, color: primary });
  cover.drawText("DOSSIER PHOTOVOLTAIQUE COMPLET", { x: 70, y: 397, size: 17, font: regular, color: accent });
  cover.drawText(pdfSafe(draft.address).slice(0, 100), { x: 70, y: 330, size: 13, font: bold, color: primary });
  cover.drawText(pdfSafe(`${draft.panelCount} modules · ${draft.rows} x ${draft.panelCount / draft.rows} · ${draft.moduleReference}`), { x: 70, y: 300, size: 10, font: regular, color: primary });
  cover.drawText("DP1 - DP8 generees dans une seule chaine coherente", { x: 70, y: 267, size: 9, font: regular, color: primary, opacity: 0.66 });
  if (branding.companyName) cover.drawText(pdfSafe(branding.companyName).slice(0, 80), { x: 70, y: 98, size: 16, font: bold, color: primary });
  if (logo) {
    const scale = Math.min(130 / logo.width, 70 / logo.height);
    cover.drawImage(logo, { x: 650, y: 465, width: logo.width * scale, height: logo.height * scale });
  }

  for (const piece of PIECES) {
    const result = results[piece.dp];
    if (!result?.base64) continue;
    const page = pdf.addPage([841.89, 595.28]);
    page.drawRectangle({ x: 0, y: 0, width: 841.89, height: 595.28, color: paper });
    page.drawRectangle({ x: 0, y: 574, width: 841.89, height: 21, color: primary });
    page.drawRectangle({ x: 650, y: 574, width: 191.89, height: 21, color: accent });
    page.drawText(`DP${piece.dp}`, { x: 34, y: 545, size: 14, font: bold, color: primary });
    page.drawText(pdfSafe(piece.title).toUpperCase(), { x: 78, y: 546, size: 9, font: bold, color: primary });

    let imageBytes = base64Bytes(result.base64);
    let image;
    if (result.mimeType.includes("jpeg") || result.mimeType.includes("jpg")) image = await pdf.embedJpg(imageBytes);
    else if (result.mimeType.includes("png")) image = await pdf.embedPng(imageBytes);
    else {
      const normalized = await pngDataUrlFromImageDataUrl(`data:${result.mimeType};base64,${result.base64}`);
      imageBytes = base64Bytes(base64FromDataUrl(normalized));
      image = await pdf.embedPng(imageBytes);
    }

    const availableWidth = 773.89;
    const availableHeight = 470;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (841.89 - width) / 2, y: 55 + (availableHeight - height) / 2, width, height });
    page.drawText(pdfSafe(branding.companyName || "PilotPaper").slice(0, 70), { x: 34, y: 23, size: 6.5, font: bold, color: primary, opacity: 0.72 });
    page.drawText(pdfSafe(draft.address).slice(0, 95), { x: 200, y: 23, size: 6.5, font: regular, color: primary, opacity: 0.62 });
  }

  return pdf.save();
}

export function CompleteDpExperience() {
  const [draft, setDraft] = useState<ProjectDraft>(DEFAULT_DRAFT);
  const [branding, setBranding] = useState<PilotPaperBranding>(DEFAULT_BRANDING);
  const [nearPhoto, setNearPhoto] = useState<PhotoValue | null>(null);
  const [farPhoto, setFarPhoto] = useState<PhotoValue | null>(null);
  const [pieces, setPieces] = useState<PieceStates>(blankPieceStates);
  const [phase, setPhase] = useState<"form" | "generating" | "ready" | "error">("form");
  const [globalError, setGlobalError] = useState("");
  const [currentDp, setCurrentDp] = useState<DPNumber | null>(null);
  const [previewDp, setPreviewDp] = useState<DPNumber | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    setDraft(initialDraftFromStorage());
    setBranding(readJson<PilotPaperBranding>(BRANDING_STORAGE_KEY, DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* local mode */ }
  }, [draft]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const columns = draft.rows > 0 && draft.panelCount % draft.rows === 0 ? draft.panelCount / draft.rows : 0;
  const compatibleRows = useMemo(() => [1, 2, 3, 4].filter((rows) => draft.panelCount % rows === 0), [draft.panelCount]);
  const completedCount = PIECES.filter(({ dp }) => pieces[dp].status === "done").length;
  const progress = Math.round((completedCount / 8) * 100);
  const canGenerate = Boolean(draft.address.trim().length >= 8 && draft.moduleReference.trim().length >= 3 && columns >= 1 && nearPhoto && farPhoto && phase !== "generating");
  const results = useMemo(() => Object.fromEntries(PIECES.flatMap(({ dp }) => pieces[dp].result ? [[dp, pieces[dp].result]] : [])) as Partial<Record<DPNumber, DpPieceOutput>>, [pieces]);

  function updateDraft(patch: Partial<ProjectDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setGlobalError("");
  }

  async function selectPhoto(role: "near" | "far", file?: File) {
    if (!file) return;
    try {
      const photo = await optimizePhoto(file, role);
      if (role === "near") setNearPhoto(photo);
      else setFarPhoto(photo);
      setGlobalError("");
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Photo invalide.");
    }
  }

  async function clearPersistedPieces() {
    await Promise.all(PIECES.map(({ dp }) => deletePersistedDpPiece(dp).catch(() => undefined)));
  }

  async function createPdf(nextResults: Partial<Record<DPNumber, DpPieceOutput>>) {
    const bytes = await buildCompletePdf(nextResults, draft, branding);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: "application/pdf" });
    setPdfUrl(URL.createObjectURL(blob));
  }

  async function generateCompleteDp() {
    if (!canGenerate || !nearPhoto || !farPhoto) return;
    abortRef.current = false;
    setPhase("generating");
    setGlobalError("");
    setPdfUrl("");
    setPieces(blankPieceStates());
    await clearPersistedPieces();

    const nextResults: Partial<Record<DPNumber, DpPieceOutput>> = {};
    const projectPhotos: PiecePhotoInput[] = [
      { role: "near", mimeType: nearPhoto.mimeType, base64: nearPhoto.base64, filename: nearPhoto.filename },
      { role: "roof", mimeType: nearPhoto.mimeType, base64: nearPhoto.base64, filename: `toiture-${nearPhoto.filename}` },
      { role: "far", mimeType: farPhoto.mimeType, base64: farPhoto.base64, filename: farPhoto.filename },
    ];

    for (const { dp } of PIECES) {
      if (abortRef.current) return;
      setCurrentDp(dp);
      setPieces((current) => ({ ...current, [dp]: { status: "running" } }));
      try {
        const response = await fetch("/api/dp-piece", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dp,
            address: draft.address.trim(),
            moduleReference: draft.moduleReference.trim(),
            panelCount: draft.panelCount,
            rows: draft.rows,
            columns,
            orientation: draft.orientation,
            placement: draft.placement,
            gutterClearanceMm: draft.gutterClearanceMm,
            interPanelGapMm: draft.panelGapMm,
            photos: projectPhotos,
            references: referencesFor(dp, nextResults),
          }),
        });
        const body = await response.json().catch(() => null) as DpPieceOutput | { error?: string } | null;
        if (!response.ok || !body || !("dp" in body)) throw new Error((body as { error?: string } | null)?.error || `DP${dp} : génération interrompue.`);
        nextResults[dp] = body;
        await persistDpPiece(body);
        setPieces((current) => ({ ...current, [dp]: { status: "done", result: body } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : `DP${dp} : erreur inconnue.`;
        setPieces((current) => ({ ...current, [dp]: { status: "error", error: message } }));
        setGlobalError(message);
        setPhase("error");
        setCurrentDp(dp);
        return;
      }
    }

    setCurrentDp(null);
    try {
      await createPdf(nextResults);
      setPhase("ready");
    } catch (error) {
      setGlobalError(error instanceof Error ? `Les 8 pièces sont prêtes, mais le PDF n'a pas pu être assemblé : ${error.message}` : "Les 8 pièces sont prêtes, mais le PDF n'a pas pu être assemblé.");
      setPhase("error");
    }
  }

  function reset() {
    abortRef.current = true;
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl("");
    setPieces(blankPieceStates());
    setCurrentDp(null);
    setPhase("form");
    setGlobalError("");
    setPreviewDp(null);
  }

  function downloadPiece(dp: DPNumber) {
    const result = pieces[dp].result;
    if (!result?.base64) return;
    const extension = result.mimeType.includes("png") ? "png" : "jpg";
    const link = document.createElement("a");
    link.href = `data:${result.mimeType};base64,${result.base64}`;
    link.download = `PilotPaper-DP${dp}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const previewResult = previewDp ? pieces[previewDp].result : undefined;

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true"><i /><i /><i /></div>

      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Sparkles /> Déclaration préalable photovoltaïque</span>
          <h1>Huit pièces.<br /><em>Un seul clic.</em></h1>
          <p>PilotPaper utilise exactement le même moteur que l’atelier K-par-k, mais orchestre automatiquement DP1 → DP8 et conserve une seule installation cohérente du début à la fin.</p>
        </div>
        <Link href="/declaration-prealable/k-par-k" className={styles.expertLink}>Ouvrir l’atelier K-par-k <ArrowRight /></Link>
      </header>

      <section className={styles.workspace}>
        <div className={styles.formPanel}>
          <div className={styles.panelHeading}>
            <span>01</span>
            <div><h2>Le projet</h2><p>Uniquement ce que le moteur ne peut pas deviner avec fiabilité.</p></div>
          </div>

          <label className={styles.field}>
            <span><MapPin /> Adresse exacte du chantier</span>
            <input value={draft.address} onChange={(event) => updateDraft({ address: event.target.value })} placeholder="45 chemin du Mérac, 71000 Mâcon" disabled={phase === "generating"} />
          </label>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span><SunMedium /> Module photovoltaïque</span>
              <select value={draft.moduleReference} onChange={(event) => updateDraft({ moduleReference: event.target.value })} disabled={phase === "generating"}>
                {MODULES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span><Layers3 /> Nombre de panneaux</span>
              <input type="number" min="1" max="80" value={draft.panelCount} onChange={(event) => updateDraft({ panelCount: Math.max(1, Number(event.target.value || 1)) })} disabled={phase === "generating"} />
            </label>
          </div>

          <div className={styles.layoutChooser}>
            <span className={styles.fieldLabel}>Disposition du champ</span>
            <div className={styles.rowChoices}>
              {compatibleRows.map((rows) => {
                const cols = draft.panelCount / rows;
                const active = draft.rows === rows;
                return <button type="button" key={rows} className={active ? styles.rowChoiceActive : styles.rowChoice} onClick={() => updateDraft({ rows })} disabled={phase === "generating"}><strong>{rows} × {cols}</strong><small>{rows} rangée{rows > 1 ? "s" : ""}</small></button>;
              })}
            </div>
          </div>

          <div className={styles.photoSection}>
            <div className={styles.panelHeadingCompact}><span>02</span><div><h2>Deux photos</h2><p>La vue proche sert aussi de source toiture pour DP3, DP4 et DP5.</p></div></div>
            <div className={styles.photoGrid}>
              <label className={`${styles.photoDrop} ${nearPhoto ? styles.photoReady : ""}`}>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectPhoto("near", event.target.files?.[0])} disabled={phase === "generating"} />
                {nearPhoto ? <img src={nearPhoto.previewUrl} alt="Vue proche" /> : <><UploadCloud /><strong>Vue proche</strong><small>Maison + toiture bien lisibles</small></>}
                {nearPhoto ? <span><Check /> Vue proche prête</span> : null}
              </label>
              <label className={`${styles.photoDrop} ${farPhoto ? styles.photoReady : ""}`}>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectPhoto("far", event.target.files?.[0])} disabled={phase === "generating"} />
                {farPhoto ? <img src={farPhoto.previewUrl} alt="Vue lointaine" /> : <><UploadCloud /><strong>Vue lointaine</strong><small>Maison dans son environnement</small></>}
                {farPhoto ? <span><Check /> Vue lointaine prête</span> : null}
              </label>
            </div>
          </div>

          <button type="button" className={styles.advancedToggle} onClick={() => setAdvancedOpen((value) => !value)} disabled={phase === "generating"}>
            <span>Préférences de pose <small>facultatif</small></span><ChevronDown className={advancedOpen ? styles.chevronOpen : ""} />
          </button>
          {advancedOpen ? <div className={styles.advancedPanel}>
            <label><span>Orientation</span><select value={draft.orientation} onChange={(event) => updateDraft({ orientation: event.target.value as ProjectDraft["orientation"] })}><option value="portrait">Portrait</option><option value="landscape">Paysage</option></select></label>
            <label><span>Placement</span><select value={draft.placement} onChange={(event) => updateDraft({ placement: event.target.value as ProjectDraft["placement"] })}><option value="centered">Centré</option><option value="left">Décalé à gauche</option><option value="right">Décalé à droite</option><option value="custom">Au mieux selon le pan</option></select></label>
          </div> : null}

          {globalError && phase !== "generating" ? <div className={styles.errorBox}>{globalError}</div> : null}

          <div className={styles.launchArea}>
            <button type="button" className={styles.launch} disabled={!canGenerate} onClick={() => void generateCompleteDp()}>
              {phase === "generating" ? <LoaderCircle className={styles.spin} /> : <WandSparkles />}
              <span><strong>{phase === "generating" ? `Génération de la DP${currentDp}…` : "Générer ma DP complète"}</strong><small>{phase === "generating" ? "PilotPaper avance automatiquement jusqu’à DP8" : "DP1 → DP8 · même moteur que K-par-k"}</small></span>
              {phase !== "generating" ? <ArrowRight /> : null}
            </button>
            <p>Le contrôle qualité reste actif en coulisses : une pièce refusée n’est jamais présentée comme valide.</p>
          </div>
        </div>

        <div className={styles.stagePanel}>
          <div className={styles.stageTop}>
            <div><span>Chaîne PilotPaper</span><strong>{phase === "ready" ? "Dossier prêt" : phase === "error" ? (currentDp ? `Arrêt sur DP${currentDp}` : "Dossier généré, export à reprendre") : phase === "generating" ? `DP${currentDp} en fabrication` : "Prêt à générer"}</strong></div>
            <div className={styles.progressDial} style={{ "--progress": `${progress * 3.6}deg` } as CSSProperties}><span>{progress}<small>%</small></span></div>
          </div>

          <div className={styles.energyStage}>
            <div className={`${styles.core} ${phase === "generating" ? styles.coreLive : ""}`}>
              <SunMedium />
              <span>PILOTPAPER</span>
              <small>{phase === "generating" ? "VISION ACTIVE" : phase === "ready" ? "8/8 PRÊTES" : "DP ENGINE"}</small>
            </div>
            <div className={styles.orbit} aria-hidden="true" />
            <div className={styles.pieceRail}>
              {PIECES.map((piece, index) => {
                const state = pieces[piece.dp];
                return <button type="button" key={piece.dp} className={`${styles.pieceNode} ${styles[`piece_${state.status}`]}`} onClick={() => state.result && setPreviewDp(piece.dp)} disabled={!state.result} style={{ "--i": index } as CSSProperties}>
                  <span>{state.status === "done" ? <Check /> : state.status === "running" ? <LoaderCircle className={styles.spin} /> : state.status === "error" ? <X /> : `0${piece.dp}`}</span>
                  <div><strong>DP{piece.dp}</strong><small>{piece.short}</small></div>
                </button>;
              })}
            </div>
          </div>

          <div className={styles.stageFooter}>
            {phase === "ready" && pdfUrl ? <>
              <a className={styles.downloadMain} href={pdfUrl} download="PilotPaper-DP-Complete.pdf"><Download /> Télécharger le dossier complet</a>
              <button type="button" className={styles.resetButton} onClick={reset}><RotateCcw /> Nouveau dossier</button>
            </> : phase === "error" && completedCount === 8 ? <>
              <button type="button" className={styles.retryButton} onClick={() => void createPdf(results)}><Download /> Réassembler le PDF</button>
              <button type="button" className={styles.resetButton} onClick={reset}>Nouveau dossier</button>
            </> : phase === "error" ? <>
              <button type="button" className={styles.retryButton} onClick={() => void generateCompleteDp()}><RotateCcw /> Relancer toute la chaîne</button>
              <button type="button" className={styles.resetButton} onClick={reset}>Modifier le projet</button>
            </> : <div className={styles.stageHint}><Sparkles /><span><strong>Une seule implantation physique</strong><small>DP2 devient l’ancre visuelle utilisée par toutes les vues suivantes.</small></span></div>}
          </div>
        </div>
      </section>

      {completedCount > 0 ? <section className={styles.resultsSection}>
        <div className={styles.resultsHeading}><div><span>Résultats</span><h2>Le dossier se construit sous vos yeux.</h2></div><strong>{completedCount}/8</strong></div>
        <div className={styles.resultsGrid}>
          {PIECES.map((piece) => {
            const result = pieces[piece.dp].result;
            if (!result?.base64) return null;
            return <article className={styles.resultCard} key={piece.dp}>
              <button type="button" className={styles.resultPreview} onClick={() => setPreviewDp(piece.dp)}><img src={`data:${result.mimeType};base64,${result.base64}`} alt={`DP${piece.dp} ${piece.title}`} /><span><Maximize2 /> Agrandir</span></button>
              <div><span>DP{piece.dp}</span><div><strong>{piece.title}</strong><small>Pièce générée et conservée</small></div><button type="button" onClick={() => downloadPiece(piece.dp)} aria-label={`Télécharger DP${piece.dp}`}><Download /></button></div>
            </article>;
          })}
        </div>
      </section> : null}

      {previewDp && previewResult?.base64 ? <div className={styles.lightbox} role="dialog" aria-modal="true">
        <button className={styles.lightboxClose} type="button" onClick={() => setPreviewDp(null)}><X /></button>
        <div className={styles.lightboxTitle}><span>DP{previewDp}</span><strong>{PIECES.find((piece) => piece.dp === previewDp)?.title}</strong></div>
        <img src={`data:${previewResult.mimeType};base64,${previewResult.base64}`} alt={`Aperçu DP${previewDp}`} />
        <button className={styles.lightboxDownload} type="button" onClick={() => downloadPiece(previewDp)}><Download /> Télécharger la DP{previewDp}</button>
      </div> : null}
    </main>
  );
}

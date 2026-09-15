"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
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
import type { DPNumber, PiecePhotoInput } from "@/lib/pilotpaper-image2-types";
import {
  createCompleteDossier,
  ensureCompleteDossierRunning,
  getCompleteDossier,
  retryCompleteDossier,
  subscribeCompleteDossier,
  type CompleteDossierBranding,
  type CompleteDossierProject,
  type CompleteDossierRecord,
} from "@/lib/pilotpaper-complete-dossiers";
import { buildProfessionalDossierPdf } from "@/lib/pilotpaper-branded-dossier-pdf";
import { BRANDING_STORAGE_KEY, DEFAULT_BRANDING, INSTALLATION_PREFS_STORAGE_KEY, type PilotPaperBranding } from "./pilotpaper-production-shell";
import styles from "./complete-dp-experience.module.css";

type PhotoValue = PiecePhotoInput & { previewUrl: string };
type InstallationPreferences = {
  moduleReference?: string;
  rows?: string;
  columns?: string;
  orientation?: "portrait" | "landscape";
  placement?: "centered" | "left" | "right" | "custom";
  panelGapMm?: string;
  gutterClearanceMm?: string;
  mountingSystem?: string;
};

type Draft = Omit<CompleteDossierProject, "columns">;

const DRAFT_KEY = "pilotpaper-complete-dp-draft-v2";
const DEFAULT_DRAFT: Draft = {
  address: "",
  moduleReference: "TSM-450NEG9R.28",
  panelCount: 12,
  rows: 2,
  orientation: "portrait",
  placement: "centered",
  panelGapMm: 20,
  gutterClearanceMm: 300,
  mountingSystem: "Surimposition parallèle au rampant",
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

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function draftFromPreferences(): Draft {
  const prefs = readJson<InstallationPreferences>(INSTALLATION_PREFS_STORAGE_KEY, {});
  const rows = Math.max(1, Number(prefs.rows || DEFAULT_DRAFT.rows));
  const columns = Math.max(1, Number(prefs.columns || 6));
  return {
    ...DEFAULT_DRAFT,
    moduleReference: prefs.moduleReference || DEFAULT_DRAFT.moduleReference,
    panelCount: rows * columns,
    rows,
    orientation: prefs.orientation || DEFAULT_DRAFT.orientation,
    placement: prefs.placement || DEFAULT_DRAFT.placement,
    panelGapMm: Math.max(0, Number(prefs.panelGapMm || DEFAULT_DRAFT.panelGapMm)),
    gutterClearanceMm: Math.max(0, Number(prefs.gutterClearanceMm || DEFAULT_DRAFT.gutterClearanceMm)),
    mountingSystem: prefs.mountingSystem || DEFAULT_DRAFT.mountingSystem,
  };
}

function initialDraft(): Draft {
  return readJson<Draft>(DRAFT_KEY, draftFromPreferences());
}

function photoDataUrl(photo: PiecePhotoInput) {
  return `data:${photo.mimeType};base64,${photo.base64}`;
}

function base64FromDataUrl(value: string) {
  return value.split(",")[1] ?? "";
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
    const maxSide = 2200;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Préparation de la photo impossible.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
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

function recordPhoto(photo: PiecePhotoInput): PhotoValue {
  return { ...photo, previewUrl: photoDataUrl(photo) };
}

function brandingFromStorage(): CompleteDossierBranding {
  const branding = readJson<PilotPaperBranding>(BRANDING_STORAGE_KEY, DEFAULT_BRANDING);
  return {
    companyName: branding.companyName,
    logoDataUrl: branding.logoDataUrl,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    paperColor: branding.paperColor,
  };
}

export function CompleteDpBackgroundExperience() {
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [nearPhoto, setNearPhoto] = useState<PhotoValue | null>(null);
  const [farPhoto, setFarPhoto] = useState<PhotoValue | null>(null);
  const [record, setRecord] = useState<CompleteDossierRecord | null>(null);
  const [dossierId, setDossierId] = useState("");
  const [error, setError] = useState("");
  const [previewDp, setPreviewDp] = useState<DPNumber | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBuilding, setPdfBuilding] = useState(false);

  useEffect(() => {
    setDraft(initialDraft());
    const id = new URLSearchParams(window.location.search).get("dossier") ?? "";
    if (!id) return;
    setDossierId(id);
    void ensureCompleteDossierRunning(id).then((loaded) => {
      if (!loaded) return;
      setRecord(loaded);
      setDraft({
        address: loaded.project.address,
        moduleReference: loaded.project.moduleReference,
        panelCount: loaded.project.panelCount,
        rows: loaded.project.rows,
        orientation: loaded.project.orientation,
        placement: loaded.project.placement,
        panelGapMm: loaded.project.panelGapMm,
        gutterClearanceMm: loaded.project.gutterClearanceMm,
        mountingSystem: loaded.project.mountingSystem,
      });
      setNearPhoto(recordPhoto(loaded.photos.near));
      setFarPhoto(recordPhoto(loaded.photos.far));
    });
  }, []);

  useEffect(() => {
    if (!dossierId) return;
    let alive = true;
    const unsubscribe = subscribeCompleteDossier(dossierId, (next) => {
      if (alive) setRecord(next);
    });
    void getCompleteDossier(dossierId).then((next) => { if (alive && next) setRecord(next); });
    return () => { alive = false; unsubscribe(); };
  }, [dossierId]);

  useEffect(() => {
    if (!record || record.status !== "ready" || pdfUrl || pdfBuilding) return;
    setPdfBuilding(true);
    void buildProfessionalDossierPdf(record).then((bytes) => {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], { type: "application/pdf" });
      setPdfUrl(URL.createObjectURL(blob));
    }).catch((pdfError) => {
      setError(pdfError instanceof Error ? `Les 8 DP sont prêtes mais l'assemblage PDF a échoué : ${pdfError.message}` : "Assemblage PDF impossible.");
    }).finally(() => setPdfBuilding(false));
  }, [record, pdfUrl, pdfBuilding]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  useEffect(() => {
    if (record) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* local only */ }
  }, [draft, record]);

  const columns = draft.rows > 0 && draft.panelCount % draft.rows === 0 ? draft.panelCount / draft.rows : 0;
  const compatibleRows = useMemo(() => [1, 2, 3, 4].filter((rows) => draft.panelCount % rows === 0), [draft.panelCount]);
  const completedCount = record ? PIECES.filter(({ dp }) => record.pieces[dp].status === "done").length : 0;
  const progress = Math.round((completedCount / 8) * 100);
  const generating = record?.status === "queued" || record?.status === "generating";
  const canGenerate = Boolean(!record && draft.address.trim().length >= 8 && draft.moduleReference && columns >= 1 && nearPhoto && farPhoto);
  const activeLabel = record?.activeDps.length ? record.activeDps.map((dp) => `DP${dp}`).join(" + ") : "";
  const previewResult = previewDp && record ? record.pieces[previewDp].result : undefined;

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  }

  async function selectPhoto(role: "near" | "far", file?: File) {
    if (!file || record) return;
    try {
      const value = await optimizePhoto(file, role);
      if (role === "near") setNearPhoto(value);
      else setFarPhoto(value);
      setError("");
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Photo invalide.");
    }
  }

  async function startGeneration() {
    if (!canGenerate || !nearPhoto || !farPhoto) return;
    setError("");
    const project: CompleteDossierProject = {
      ...draft,
      address: draft.address.trim(),
      moduleReference: draft.moduleReference.trim(),
      columns,
    };
    const created = await createCompleteDossier({
      project,
      branding: brandingFromStorage(),
      photos: {
        near: { role: "near", mimeType: nearPhoto.mimeType, base64: nearPhoto.base64, filename: nearPhoto.filename },
        far: { role: "far", mimeType: farPhoto.mimeType, base64: farPhoto.base64, filename: farPhoto.filename },
      },
    });
    setRecord(created);
    setDossierId(created.id);
    const url = new URL(window.location.href);
    url.searchParams.set("dossier", created.id);
    window.history.replaceState({}, "", url.toString());
  }

  function newDossier() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl("");
    setRecord(null);
    setDossierId("");
    setPreviewDp(null);
    setError("");
    setNearPhoto(null);
    setFarPhoto(null);
    setDraft(draftFromPreferences());
    const url = new URL(window.location.href);
    url.searchParams.delete("dossier");
    window.history.replaceState({}, "", url.toString());
  }

  function downloadPiece(dp: DPNumber) {
    const result = record?.pieces[dp].result;
    if (!result?.base64) return;
    const extension = result.mimeType.includes("png") ? "png" : result.mimeType.includes("webp") ? "webp" : "jpg";
    const link = document.createElement("a");
    link.href = `data:${result.mimeType};base64,${result.base64}`;
    link.download = `PilotPaper-${record.id}-DP${dp}.${extension}`;
    link.click();
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true"><i /><i /><i /></div>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Sparkles /> Déclaration préalable photovoltaïque</span>
          <h1>Huit pièces.<br /><em>Un seul clic.</em></h1>
          <p>DP1 et DP2 démarrent en parallèle, puis les pièces visuelles sont produites par vagues tout en restant verrouillées sur la même DP2. La génération continue même si vous quittez cette page.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/declaration-prealable/mes-dossiers" className={styles.expertLink}><FolderOpen /> Mes dossiers</Link>
          <Link href="/declaration-prealable/k-par-k" className={styles.expertLink}>K-par-k <ArrowRight /></Link>
        </div>
      </header>

      <section className={styles.workspace}>
        <div className={styles.formPanel}>
          <div className={styles.panelHeading}><span>01</span><div><h2>Le projet</h2><p>Le strict minimum. Les préférences enregistrées sont appliquées automatiquement.</p></div></div>
          <label className={styles.field}><span><MapPin /> Adresse exacte du chantier</span><input value={draft.address} onChange={(event) => updateDraft({ address: event.target.value })} placeholder="110 Rue Basse, 71260 Azé" disabled={Boolean(record)} /></label>
          <div className={styles.formGrid}>
            <label className={styles.field}><span><SunMedium /> Module photovoltaïque</span><select value={draft.moduleReference} onChange={(event) => updateDraft({ moduleReference: event.target.value })} disabled={Boolean(record)}>{MODULES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className={styles.field}><span><Layers3 /> Nombre de panneaux</span><input type="number" min="1" max="80" value={draft.panelCount} onChange={(event) => updateDraft({ panelCount: Math.max(1, Number(event.target.value || 1)) })} disabled={Boolean(record)} /></label>
          </div>
          <div className={styles.layoutChooser}><span className={styles.fieldLabel}>Disposition du champ</span><div className={styles.rowChoices}>{compatibleRows.map((rows) => <button type="button" key={rows} className={draft.rows === rows ? styles.rowChoiceActive : styles.rowChoice} onClick={() => updateDraft({ rows })} disabled={Boolean(record)}><strong>{rows} × {draft.panelCount / rows}</strong><small>{rows} rangée{rows > 1 ? "s" : ""}</small></button>)}</div></div>

          <div className={styles.photoSection}>
            <div className={styles.panelHeadingCompact}><span>02</span><div><h2>Deux photos</h2><p>Vue proche + vue lointaine. La vue proche sert automatiquement de source toiture.</p></div></div>
            <div className={styles.photoGrid}>
              <label className={`${styles.photoDrop} ${nearPhoto ? styles.photoReady : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectPhoto("near", event.target.files?.[0])} disabled={Boolean(record)} />{nearPhoto ? <img src={nearPhoto.previewUrl} alt="Vue proche" /> : <><UploadCloud /><strong>Vue proche</strong><small>Maison + toiture bien lisibles</small></>}{nearPhoto ? <span><Check /> Vue proche prête</span> : null}</label>
              <label className={`${styles.photoDrop} ${farPhoto ? styles.photoReady : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectPhoto("far", event.target.files?.[0])} disabled={Boolean(record)} />{farPhoto ? <img src={farPhoto.previewUrl} alt="Vue lointaine" /> : <><UploadCloud /><strong>Vue lointaine</strong><small>Maison dans son environnement</small></>}{farPhoto ? <span><Check /> Vue lointaine prête</span> : null}</label>
            </div>
          </div>

          <button type="button" className={styles.advancedToggle} onClick={() => setAdvancedOpen((value) => !value)} disabled={Boolean(record)}><span>Préférences appliquées <small>issues des paramètres</small></span><ChevronDown className={advancedOpen ? styles.chevronOpen : ""} /></button>
          {advancedOpen ? <div className={styles.advancedPanel}>
            <label><span>Orientation</span><select value={draft.orientation} onChange={(event) => updateDraft({ orientation: event.target.value as Draft["orientation"] })} disabled={Boolean(record)}><option value="portrait">Portrait</option><option value="landscape">Paysage</option></select></label>
            <label><span>Placement</span><select value={draft.placement} onChange={(event) => updateDraft({ placement: event.target.value as Draft["placement"] })} disabled={Boolean(record)}><option value="centered">Centré</option><option value="left">Décalé à gauche</option><option value="right">Décalé à droite</option><option value="custom">Au mieux selon le pan</option></select></label>
            <label><span>Jeu inter-panneaux</span><input type="number" min="0" value={draft.panelGapMm} onChange={(event) => updateDraft({ panelGapMm: Math.max(0, Number(event.target.value || 0)) })} disabled={Boolean(record)} /></label>
            <label><span>Recul gouttière préféré</span><input type="number" min="0" value={draft.gutterClearanceMm} onChange={(event) => updateDraft({ gutterClearanceMm: Math.max(0, Number(event.target.value || 0)) })} disabled={Boolean(record)} /></label>
            <label style={{ gridColumn: "1 / -1" }}><span>Système de pose</span><input value={draft.mountingSystem} onChange={(event) => updateDraft({ mountingSystem: event.target.value })} disabled={Boolean(record)} /></label>
          </div> : null}

          {error || record?.error ? <div className={styles.errorBox}>{error || record?.error}</div> : null}
          <div className={styles.launchArea}>
            {!record ? <button type="button" className={styles.launch} disabled={!canGenerate} onClick={() => void startGeneration()}><WandSparkles /><span><strong>Générer ma DP complète</strong><small>DP1 → DP8 · génération de fond · parallélisation contrôlée</small></span><ArrowRight /></button> : generating ? <div className={styles.launch}><LoaderCircle className={styles.spin} /><span><strong>{activeLabel ? `${activeLabel} en fabrication` : "PilotPaper prépare la prochaine vague…"}</strong><small>Vous pouvez quitter cette page : le dossier continue dans Mes dossiers.</small></span></div> : record.status === "ready" ? <button type="button" className={styles.launch} onClick={newDossier}><Check /><span><strong>Dossier terminé</strong><small>Les 8 pièces sont sauvegardées dans Mes dossiers.</small></span><ArrowRight /></button> : <button type="button" className={styles.launch} onClick={() => void retryCompleteDossier(record.id)}><RotateCcw /><span><strong>Relancer les pièces en erreur</strong><small>Les pièces déjà validées sont conservées.</small></span><ArrowRight /></button>}
            <p>L’Inspector reste actif uniquement en coulisses. Il ne crée plus d’étape de contrôle utilisateur.</p>
          </div>
        </div>

        <div className={styles.stagePanel}>
          <div className={styles.stageTop}><div><span>Chaîne PilotPaper de fond</span><strong>{record?.status === "ready" ? "Dossier prêt" : generating ? (activeLabel || "Initialisation") : record?.status === "error" ? "Correction requise" : "Prêt à générer"}</strong></div><div className={styles.progressDial} style={{ "--progress": `${progress * 3.6}deg` } as CSSProperties}><span>{progress}<small>%</small></span></div></div>
          <div className={styles.energyStage}>
            <div className={`${styles.core} ${generating ? styles.coreLive : ""}`}><SunMedium /><span>PILOTPAPER</span><small>{generating ? "BACKGROUND ACTIVE" : record?.status === "ready" ? "8/8 PRÊTES" : "DP ENGINE"}</small></div>
            <div className={styles.orbit} aria-hidden="true" />
            <div className={styles.pieceRail}>{PIECES.map((piece, index) => {
              const state = record?.pieces[piece.dp] ?? { status: "idle" as const };
              return <button type="button" key={piece.dp} className={`${styles.pieceNode} ${styles[`piece_${state.status}`]}`} onClick={() => state.result && setPreviewDp(piece.dp)} disabled={!state.result} style={{ "--i": index } as CSSProperties}><span>{state.status === "done" ? <Check /> : state.status === "running" ? <LoaderCircle className={styles.spin} /> : state.status === "error" ? <X /> : `0${piece.dp}`}</span><div><strong>DP{piece.dp}</strong><small>{piece.short}</small></div></button>;
            })}</div>
          </div>
          <div className={styles.stageFooter}>{record?.status === "ready" ? <>{pdfUrl ? <a className={styles.downloadMain} href={pdfUrl} download={`PilotPaper-${record.id}.pdf`}><Download /> Télécharger le dossier pro</a> : <span className={styles.stageHint}><LoaderCircle className={styles.spin} /><span><strong>Assemblage du PDF professionnel</strong><small>Logo, en-tête et encadrement aux couleurs de la société.</small></span></span>}<button type="button" className={styles.resetButton} onClick={newDossier}>Nouveau dossier</button></> : <div className={styles.stageHint}><Sparkles /><span><strong>Plus rapide sans sacrifier la cohérence</strong><small>DP2 reste l’ancre unique ; deux pièces lourdes maximum sont produites simultanément.</small></span></div>}</div>
        </div>
      </section>

      {completedCount > 0 && record ? <section className={styles.resultsSection}><div className={styles.resultsHeading}><div><span>Mes pièces</span><h2>Le dossier se construit même hors de cette page.</h2></div><strong>{completedCount}/8</strong></div><div className={styles.resultsGrid}>{PIECES.map((piece) => {
        const result = record.pieces[piece.dp].result;
        if (!result?.base64) return null;
        return <article className={styles.resultCard} key={piece.dp}><button type="button" className={styles.resultPreview} onClick={() => setPreviewDp(piece.dp)}><img src={`data:${result.mimeType};base64,${result.base64}`} alt={`DP${piece.dp} ${piece.title}`} /><span><Maximize2 /> Agrandir</span></button><div><span>DP{piece.dp}</span><div><strong>{piece.title}</strong><small>Sauvegardée dans ce dossier</small></div><button type="button" onClick={() => downloadPiece(piece.dp)}><Download /></button></div></article>;
      })}</div></section> : null}

      {previewDp && previewResult?.base64 ? <div className={styles.lightbox} role="dialog" aria-modal="true"><button className={styles.lightboxClose} type="button" onClick={() => setPreviewDp(null)}><X /></button><div className={styles.lightboxTitle}><span>DP{previewDp}</span><strong>{PIECES.find((piece) => piece.dp === previewDp)?.title}</strong></div><img src={`data:${previewResult.mimeType};base64,${previewResult.base64}`} alt={`Aperçu DP${previewDp}`} /><button className={styles.lightboxDownload} type="button" onClick={() => downloadPiece(previewDp)}><Download /> Télécharger la DP{previewDp}</button></div> : null}
    </main>
  );
}

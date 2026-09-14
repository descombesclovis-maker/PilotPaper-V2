"use client";

/* eslint-disable react/no-unescaped-entities */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileImage,
  MapPinned,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { DP_PIECE_CONTRACTS, type DpPieceField } from "@/lib/dp-piece-contract";
import type { DPNumber, DpPieceOutput, PhotoRole, VisualReference } from "@/lib/pilotpaper-image2-types";
import {
  deletePersistedDpPiece,
  loadPersistedDpPieces,
  persistDpPiece,
} from "@/lib/pilotpaper-image2-persistence";
import {
  GenerationDock,
  SolarGenerationStage,
  type GenerationJobView,
} from "./solar-generation-ui";
import styles from "./dp-piece-workbench.module.css";

type PhotoValue = {
  role: PhotoRole;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  filename: string;
};

type Draft = {
  address: string;
  moduleReference: string;
  panelCount: string;
  rows: string;
  columns: string;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  instructions: string;
  roofWidthMm: string;
  roofSlopeLengthMm: string;
  roofSlopeDeg: string;
  gutterClearanceMm: string;
  interPanelGapMm: string;
};

type HistoryState = Partial<Record<DPNumber, { tests: number; lastPassed: boolean }>>;
type ResultsState = Partial<Record<DPNumber, DpPieceOutput>>;
type ApiFailure = { error?: string };
type QueueTask = {
  id: string;
  dp: DPNumber;
  draft: Draft;
  photos: Partial<Record<PhotoRole, PhotoValue>>;
};

const defaultDraft: Draft = {
  address: "",
  moduleReference: "TSM-450NEG9R.28",
  panelCount: "12",
  rows: "2",
  columns: "6",
  orientation: "portrait",
  placement: "centered",
  instructions: "",
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
  address: { label: "Adresse exacte du projet", hint: "Utilisée pour retrouver la vue IGN et la parcelle cadastrale des DP1/DP2." },
  moduleReference: { label: "Module photovoltaïque", hint: "Les dimensions réelles viennent du catalogue fabricant." },
  panelCount: { label: "Nombre exact de panneaux" },
  rows: { label: "Rangées" },
  columns: { label: "Colonnes" },
  orientation: { label: "Orientation des panneaux" },
  placement: { label: "Placement souhaité" },
  instructions: { label: "Consigne libre à ChatGPT Image", hint: "Ex. pan côté rue, légèrement décalé à droite, conserver le Velux entre les deux zones…" },
  roofWidthMm: { label: "Largeur réelle du pan (mm)", hint: "DP3 : renseigner uniquement une mesure fiable." },
  roofSlopeLengthMm: { label: "Longueur réelle du rampant (mm)", hint: "DP3 : gouttière → faîtage, si connue." },
  roofSlopeDeg: { label: "Pente réelle du toit (°)", hint: "DP3 : uniquement si connue." },
  gutterClearanceMm: { label: "Recul bas préféré (mm)", hint: "300 mm par défaut ; ChatGPT peut le réduire si nécessaire pour faire rentrer la matrice exacte." },
  interPanelGapMm: { label: "Jeu entre panneaux (mm)" },
  nearPhoto: { label: "Photo réelle de la maison", hint: "Maison + toiture clairement lisibles." },
  roofPhoto: { label: "Photo rapprochée toiture", hint: "Utilisée pour la DP5 et sa nouvelle vue plus haute." },
  farPhoto: { label: "Photo lointaine", hint: "Maison replacée dans son environnement réel pour DP6/DP8." },
};

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function initialDraft(): Draft {
  try {
    const saved = localStorage.getItem("pilotpaper-image2-draft");
    return saved ? { ...defaultDraft, ...JSON.parse(saved) } as Draft : defaultDraft;
  } catch {
    return defaultDraft;
  }
}

function initialHistory(): HistoryState {
  try {
    const saved = localStorage.getItem("pilotpaper-image2-history");
    return saved ? JSON.parse(saved) as HistoryState : {};
  } catch {
    return {};
  }
}

async function fileToPhoto(file: File, role: PhotoRole): Promise<PhotoValue> {
  if (file.size > 18 * 1024 * 1024) throw new Error("Photo trop lourde : 18 Mo maximum.");
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Format non pris en charge : utilisez JPEG, PNG ou WebP.");
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

function referenceOrder(dp: DPNumber): Array<2 | 3 | 4 | 5> {
  if (dp === 3) return [2];
  if (dp === 4) return [2, 3];
  if (dp === 5) return [4, 2, 3];
  if (dp === 6) return [5, 4, 2];
  return [];
}

export function DpPieceWorkbench() {
  const [selectedDp, setSelectedDp] = useState<DPNumber | null>(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [photos, setPhotos] = useState<Partial<Record<PhotoRole, PhotoValue>>>({});
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryState>(initialHistory);
  const [resultsByDp, setResultsByDp] = useState<ResultsState>({});
  const [jobs, setJobs] = useState<GenerationJobView[]>([]);
  const resultsRef = useRef<ResultsState>({});
  const queueRef = useRef<QueueTask[]>([]);
  const processingRef = useRef(false);

  const contract = useMemo(() => DP_PIECE_CONTRACTS.find((piece) => piece.dp === selectedDp) ?? null, [selectedDp]);
  const result = contract ? resultsByDp[contract.dp] ?? null : null;
  const currentJob = contract ? jobs.find((job) => job.dp === contract.dp && (job.status === "queued" || job.status === "running")) ?? null : null;
  const previewUrl = useMemo(() => result?.base64 ? `data:${result.mimeType};base64,${result.base64}` : "", [result]);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedDpPieces().then((stored) => {
      if (cancelled) return;
      resultsRef.current = stored;
      setResultsByDp(stored);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setError("");
    try { localStorage.setItem("pilotpaper-image2-draft", JSON.stringify(next)); } catch { /* ignore */ }
  }

  async function setPhoto(role: PhotoRole, file?: File) {
    if (!file) return;
    try {
      const value = await fileToPhoto(file, role);
      setPhotos((current) => ({ ...current, [role]: value }));
      setError("");
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Photo invalide.");
    }
  }

  function openPiece(dp: DPNumber) {
    setSelectedDp(dp);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function resetPiece() {
    if (!contract) return;
    if (!window.confirm(`Effacer le résultat sauvegardé de la DP${contract.dp} et recommencer ?`)) return;
    await deletePersistedDpPiece(contract.dp).catch(() => undefined);
    const next = { ...resultsRef.current };
    delete next[contract.dp];
    resultsRef.current = next;
    setResultsByDp(next);
    setError("");
  }

  function referencesFor(dp: DPNumber, source = resultsRef.current): VisualReference[] {
    return referenceOrder(dp).flatMap((referenceDp) => {
      const candidate = source[referenceDp];
      if (!candidate?.base64) return [];
      if (!["image/png", "image/jpeg", "image/webp"].includes(candidate.mimeType)) return [];
      return [{ dp: referenceDp, mimeType: candidate.mimeType as VisualReference["mimeType"], base64: candidate.base64 }];
    });
  }

  function patchJob(id: string, patch: Partial<GenerationJobView>) {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job));
  }

  async function processQueue() {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length) {
      const task = queueRef.current.shift();
      if (!task) break;
      patchJob(task.id, { status: "running", startedAt: Date.now(), error: undefined });

      try {
        const payload = {
          dp: task.dp,
          address: task.draft.address,
          moduleReference: task.draft.moduleReference,
          panelCount: numeric(task.draft.panelCount),
          rows: numeric(task.draft.rows),
          columns: numeric(task.draft.columns),
          orientation: task.draft.orientation,
          placement: task.draft.placement,
          instructions: task.draft.instructions,
          roofWidthMm: numeric(task.draft.roofWidthMm),
          roofSlopeLengthMm: numeric(task.draft.roofSlopeLengthMm),
          roofSlopeDeg: numeric(task.draft.roofSlopeDeg),
          gutterClearanceMm: numeric(task.draft.gutterClearanceMm),
          interPanelGapMm: numeric(task.draft.interPanelGapMm),
          photos: Object.values(task.photos),
          references: referencesFor(task.dp),
        };

        const response = await fetch("/api/dp-piece", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null) as DpPieceOutput | ApiFailure | null;
        if (!response.ok || !body || !("dp" in body)) {
          throw new Error((body as ApiFailure | null)?.error || `Génération impossible (${response.status}).`);
        }

        const nextResults = { ...resultsRef.current, [body.dp]: body };
        resultsRef.current = nextResults;
        setResultsByDp(nextResults);
        await persistDpPiece(body);

        setHistory((current) => {
          const previous = current[body.dp];
          const next = { ...current, [body.dp]: { tests: (previous?.tests ?? 0) + 1, lastPassed: body.inspector.passed } };
          try { localStorage.setItem("pilotpaper-image2-history", JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
        patchJob(task.id, { status: "done", finishedAt: Date.now() });
      } catch (generationError) {
        const message = generationError instanceof Error ? generationError.message : "La génération a échoué.";
        patchJob(task.id, { status: "failed", finishedAt: Date.now(), error: message });
        if (selectedDp === task.dp) setError(message);
      }
    }

    processingRef.current = false;
  }

  function generate() {
    if (!contract) return;
    const duplicate = jobs.some((job) => job.dp === contract.dp && (job.status === "queued" || job.status === "running"));
    if (duplicate) {
      setError(`La DP${contract.dp} est déjà en cours ou dans la file d’attente.`);
      return;
    }

    const id = `${contract.dp}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const task: QueueTask = {
      id,
      dp: contract.dp,
      draft: { ...draft },
      photos: { ...photos },
    };
    queueRef.current.push(task);
    setJobs((current) => [...current, { id, dp: contract.dp, status: "queued", createdAt: Date.now() }]);
    setError("");
    void processQueue();
  }

  function downloadResult() {
    if (!result?.base64) return;
    const extension = result.mimeType.includes("png") ? "png" : result.mimeType.includes("webp") ? "webp" : "jpg";
    const link = document.createElement("a");
    link.href = `data:${result.mimeType};base64,${result.base64}`;
    link.download = `PilotPaper-DP${result.dp}-TEST.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function inputField(field: DpPieceField) {
    const meta = fieldLabels[field];
    if (["nearPhoto", "roofPhoto", "farPhoto"].includes(field)) {
      const role: PhotoRole = field === "nearPhoto" ? "near" : field === "roofPhoto" ? "roof" : "far";
      const current = photos[role];
      return (
        <label className={styles.photoField} key={field}>
          <span className={styles.fieldTitle}>{meta.label}</span>
          <span className={styles.fieldHint}>{meta.hint}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void setPhoto(role, event.target.files?.[0])} />
          <span className={current ? styles.photoReady : styles.photoEmpty}><FileImage size={17} /> {current ? current.filename : "Choisir une photo"}</span>
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
      return <label className={styles.field} key={field}><span className={styles.fieldTitle}>{meta.label}</span><select value={draft.placement} onChange={(event) => update("placement", event.target.value as Draft["placement"])}><option value="centered">Centré</option><option value="left">Décalé à gauche</option><option value="right">Décalé à droite</option><option value="custom">Suivre ma consigne libre</option></select></label>;
    }
    if (field === "instructions") {
      return (
        <label className={`${styles.field} ${styles.wide}`} key={field}>
          <span className={styles.fieldTitle}>{meta.label}</span><span className={styles.fieldHint}>{meta.hint}</span>
          <textarea rows={4} value={draft.instructions} onChange={(event) => update("instructions", event.target.value)} placeholder="Décris simplement le résultat attendu comme tu le ferais dans ChatGPT…" />
        </label>
      );
    }
    const key = field as keyof Draft;
    const isNumber = ["panelCount", "rows", "columns", "roofWidthMm", "roofSlopeLengthMm", "roofSlopeDeg", "gutterClearanceMm", "interPanelGapMm"].includes(field);
    return (
      <label className={`${styles.field} ${field === "address" ? styles.wide : ""}`} key={field}>
        <span className={styles.fieldTitle}>{meta.label}</span>{meta.hint ? <span className={styles.fieldHint}>{meta.hint}</span> : null}
        <input type={isNumber ? "number" : "text"} min={isNumber ? 0 : undefined} value={String(draft[key] ?? "")} onChange={(event) => update(key, event.target.value as never)} placeholder={field === "address" ? "Ex. 2 Hameau du Chêne, 71260 Senozan" : undefined} />
      </label>
    );
  }

  if (!contract) {
    return (
      <main className={styles.app} data-pilotpaper-image2-workbench>
        <header className={styles.topbar}>
          <div className={styles.brand}><img src="/pilotpaper-dp.svg" alt="dP" /><div><strong>PilotPaper</strong><span>Image-2 · Atelier de validation</span></div></div>
          <div className={styles.testBadge}><span /> MODE TEST · NON VALIDÉ</div>
        </header>
        <section className={styles.hero}>
          <div><span className={styles.eyebrow}>NOUVEAU MOTEUR DIRECT</span><h1>Une vraie source.<br />ChatGPT Image. Une DP.</h1><p>DP1 à DP6 passent directement par ChatGPT Image-2. Plus de masque, Site Twin, recalage caméra ou Geometry Engine dans le chemin de génération. Les DP2 à DP6 partagent la même identité visuelle de projet.</p></div>
          <div className={styles.heroStatus}><Sparkles size={28} /><strong>Pipeline simplifié</strong><span>Source réelle → prompt projet partagé → gpt-image-2 → Inspector</span></div>
        </section>
        <section className={styles.grid}>
          {DP_PIECE_CONTRACTS.map((piece) => {
            const state = history[piece.dp];
            const saved = resultsByDp[piece.dp];
            const active = jobs.find((job) => job.dp === piece.dp && (job.status === "running" || job.status === "queued"));
            return (
              <button className={styles.pieceCard} key={piece.dp} onClick={() => openPiece(piece.dp)}>
                <div className={styles.cardTop}>
                  <span className={styles.dpNumber}>DP{piece.dp}</span>
                  {active ? <span className={styles.queueDot}>{active.status === "running" ? "En cours" : "En attente"}</span> : saved ? <span className={styles.passDot}>Sauvegardée</span> : state ? <span className={state.lastPassed ? styles.passDot : styles.failDot}>{state.tests} test{state.tests > 1 ? "s" : ""}</span> : <span className={styles.newDot}>À tester</span>}
                </div>
                <h2>{piece.title}</h2><p>{piece.purpose}</p>
                <div className={styles.pipelineTags}>{piece.generatedByImage2 ? <span>ChatGPT Image-2</span> : <span>Photo originale</span>}{piece.usesInspector ? <span>Inspector</span> : null}</div>
                <span className={styles.openLabel}>{saved ? "Rouvrir le résultat →" : "Ouvrir l’atelier →"}</span>
              </button>
            );
          })}
        </section>
        <GenerationDock jobs={jobs} onOpenDp={openPiece} />
      </main>
    );
  }

  const references = referencesFor(contract.dp, resultsByDp);

  return (
    <main className={styles.app} data-pilotpaper-image2-workbench>
      <header className={styles.topbar}>
        <button className={styles.back} onClick={() => setSelectedDp(null)}><ArrowLeft size={18} /> Toutes les pièces</button>
        <div className={styles.brandCompact}><img src="/pilotpaper-dp.svg" alt="dP" /><strong>PilotPaper Image-2</strong></div>
        <div className={styles.testBadge}><span /> TEST · NON VALIDÉ</div>
      </header>

      <section className={styles.workspaceHeader}>
        <div className={styles.dpHeroNumber}>DP{contract.dp}</div>
        <div><span className={styles.eyebrow}>{contract.generatedByImage2 ? "CHATGPT IMAGE-2 DIRECT" : "PHOTO ORIGINALE"}</span><h1>{contract.title}</h1><p>{contract.purpose}</p></div>
        <button className={styles.reset} onClick={() => void resetPiece()} disabled={!result || Boolean(currentJob)}><RotateCcw size={16} /> Effacer et recommencer</button>
      </section>

      <div className={styles.workspace}>
        <section className={styles.formPanel}>
          <div className={styles.panelHeading}><div><span>FORMULAIRE DP{contract.dp}</span><h2>Les données réellement utiles</h2></div><MapPinned size={24} /></div>
          <div className={styles.formGrid}>{contract.fields.map(inputField)}</div>

          {contract.dp >= 3 && contract.dp <= 6 ? (
            <div className={styles.sources}>
              <strong>Cohérence inter-DP</strong>
              <span>{references.length ? `Références déjà disponibles : ${references.map((ref) => `DP${ref.dp}`).join(", ")}` : "Aucune DP antérieure en mémoire pour l'instant."}</span>
              <span>Les générations antérieures restent sauvegardées et sont réutilisées automatiquement pour maintenir le même projet.</span>
            </div>
          ) : null}

          {error ? <div className={styles.error}><TriangleAlert size={19} /><span>{error}</span></div> : null}

          <button className={styles.generate} disabled={Boolean(currentJob)} onClick={generate}>
            {currentJob ? <>{currentJob.status === "running" ? `DP${contract.dp} en génération réelle…` : `DP${contract.dp} ajoutée à la file d’attente`}</> : contract.generatedByImage2 ? <>Générer DP{contract.dp} avec ChatGPT Image <span>TEST</span></> : <>Utiliser la photo originale DP{contract.dp}</>}
          </button>
          <p className={styles.modeNote}>Tu peux quitter cette DP immédiatement après le lancement : le job continue dans le dock latéral. Les lancements suivants sont mis en file d’attente et les résultats restent enregistrés jusqu’à suppression explicite.</p>
        </section>

        <section className={styles.previewPanel}>
          <div className={styles.panelHeading}>
            <div><span>RÉSULTAT</span><h2>Contrôle visuel</h2></div>
            {result && !currentJob ? <button className={styles.download} onClick={downloadResult}><Download size={16} /> Exporter</button> : null}
          </div>

          {currentJob ? (
            <SolarGenerationStage job={currentJob} />
          ) : result ? (
            <>
              <div className={styles.previewCanvas}>{previewUrl ? <img src={previewUrl} alt={`Résultat DP${contract.dp}`} /> : null}</div>
              <div className={result.inspector.passed ? styles.inspectorPass : styles.inspectorFail}>
                <div className={styles.inspectorTitle}>{result.inspector.passed ? <CheckCircle2 size={20} /> : <TriangleAlert size={20} />}<strong>{contract.usesInspector ? "PilotPaper Inspector" : "Source originale"}</strong><span>{Math.round(result.inspector.score * 100)} %</span></div>
                {result.inspector.checks.map((check) => <p key={check}>✓ {check}</p>)}
                {result.inspector.issues.map((issue) => <p key={issue}>⚠ {issue}</p>)}
              </div>
              <div className={styles.sources}><strong>Pipeline utilisé</strong>{result.sourceSummary.map((source) => <span key={source}>{source}</span>)}</div>
              <div className={styles.persistNotice}><CheckCircle2 size={16} /><span>Cette DP est sauvegardée localement. Elle restera disponible en changeant de page ou après relance de PilotPaper, jusqu’à « Effacer et recommencer ».</span></div>
            </>
          ) : (
            <div className={styles.emptyPreview}>
              {contract.dp === 1 ? <img src="/pilotpaper-france-map.svg" alt="Carte de France" /> : <img src="/pilotpaper-dp.svg" alt="" />}
              <strong>DP{contract.dp} en attente</strong>
              <span>{contract.generatedByImage2 ? "ChatGPT Image recevra la source complète et les consignes du formulaire, sans masque ni reconstruction géométrique préalable." : "La photographie originale apparaîtra ici sans retouche."}</span>
            </div>
          )}
        </section>
      </div>
      <GenerationDock jobs={jobs} onOpenDp={openPiece} />
    </main>
  );
}

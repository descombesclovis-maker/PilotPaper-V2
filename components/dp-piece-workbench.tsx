"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
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
import styles from "./dp-piece-workbench.module.css";

type PhotoValue = { role: "near" | "roof" | "far"; mimeType: "image/jpeg" | "image/png" | "image/webp"; base64: string; filename: string };
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
  roofFace: "A",
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
  address: { label: "Adresse exacte du projet", hint: "PilotPaper interroge l'IGN et le cadastre lorsque la pièce l'exige." },
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

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [photos, setPhotos] = useState<Partial<Record<PhotoValue["role"], PhotoValue>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PieceResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [history, setHistory] = useState<Partial<Record<DPNumber, { tests: number; lastPassed: boolean }>>>({});

  const contract = useMemo(() => DP_PIECE_CONTRACTS.find((piece) => piece.dp === selectedDp) ?? null, [selectedDp]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pilotpaper-v1-k-par-k-draft");
      if (saved) setDraft((current) => ({ ...current, ...JSON.parse(saved) }));
      const savedHistory = localStorage.getItem("pilotpaper-v1-k-par-k-history");
      if (savedHistory) setHistory(JSON.parse(savedHistory));
    } catch { /* local draft is optional */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("pilotpaper-v1-k-par-k-draft", JSON.stringify(draft)); } catch { /* ignore */ }
  }, [draft]);

  useEffect(() => {
    if (!result) { setPreviewUrl(""); return; }
    let url = "";
    if (result.text) {
      url = URL.createObjectURL(new Blob([result.text], { type: result.mimeType }));
    } else if (result.base64) {
      url = `data:${result.mimeType};base64,${result.base64}`;
    }
    setPreviewUrl(url);
    return () => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [result]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function openPiece(dp: DPNumber) {
    setSelectedDp(dp);
    setResult(null);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetPiece() {
    setResult(null);
    setError("");
    setPhotos({});
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

  async function generate() {
    if (!contract) return;
    setBusy(true);
    setError("");
    setResult(null);
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
      };
      const response = await fetch("/api/dp-piece", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as PieceResult | { error?: string } | null;
      if (!response.ok || !body || !("dp" in body)) throw new Error((body && "error" in body && body.error) || `Génération impossible (${response.status}).`);
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
    const meta = fieldLabels[field];
    if (["nearPhoto", "roofPhoto", "farPhoto"].includes(field)) {
      const role = field === "nearPhoto" ? "near" : field === "roofPhoto" ? "roof" : "far";
      const photo = photos[role];
      return (
        <label className={styles.photoField} key={field}>
          <span className={styles.fieldTitle}>{meta.label}</span>
          <span className={styles.fieldHint}>{meta.hint}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void setPhoto(role, event.target.files?.[0])} />
          <span className={photo ? styles.photoReady : styles.photoEmpty}>
            <FileImage size={17} /> {photo ? photo.filename : "Choisir une photo"}
          </span>
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
          <div className={styles.brand}>
            <img src="/pilotpaper-dp.svg" alt="dP" />
            <div><strong>PilotPaper</strong><span>V1 · Atelier de validation</span></div>
          </div>
          <div className={styles.testBadge}><span /> MODE TEST · NON VALIDÉ</div>
        </header>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>VALIDATION K-PAR-K</span>
            <h1>Une pièce. Un formulaire.<br />Un résultat à contrôler.</h1>
            <p>On fiabilise DP1 à DP8 séparément avant de reconstruire le dossier automatique complet. Chaque défaut observé devient une règle générale et un test de régression.</p>
          </div>
          <div className={styles.heroStatus}>
            <ShieldCheck size={28} />
            <strong>Architecture V1 verrouillée</strong>
            <span>Roof Understanding → Layout → Projection → Render → Inspector → Régression</span>
          </div>
        </section>
        <section className={styles.grid}>
          {DP_PIECE_CONTRACTS.map((piece) => {
            const state = history[piece.dp];
            return (
              <button className={styles.pieceCard} key={piece.dp} onClick={() => openPiece(piece.dp)}>
                <div className={styles.cardTop}><span className={styles.dpNumber}>DP{piece.dp}</span>{state ? <span className={state.lastPassed ? styles.passDot : styles.failDot}>{state.tests} test{state.tests > 1 ? "s" : ""}</span> : <span className={styles.newDot}>À tester</span>}</div>
                <h2>{piece.title}</h2>
                <p>{piece.purpose}</p>
                <div className={styles.pipelineTags}>
                  {piece.usesRoofUnderstanding ? <span>Roof</span> : null}
                  {piece.usesLayout ? <span>Layout</span> : null}
                  {piece.usesProjection ? <span>Projection</span> : null}
                  {piece.usesPhotorealisticRender ? <span>Render IA</span> : null}
                  {piece.usesInspector ? <span>Inspector</span> : null}
                </div>
                <span className={styles.openLabel}>Ouvrir l'atelier →</span>
              </button>
            );
          })}
        </section>
      </main>
    );
  }

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
          {error ? <div className={styles.error}><TriangleAlert size={19} /><span>{error}</span></div> : null}
          <button className={styles.generate} disabled={busy} onClick={() => void generate()}>
            {busy ? <><LoaderCircle className={styles.spin} size={19} /> PilotPaper travaille…</> : <>Générer DP{contract.dp} <span>TEST</span></>}
          </button>
          <p className={styles.modeNote}>Cette V1 ne peut produire qu'un résultat <strong>test_unverified</strong>. Aucun clic ne peut le transformer en document de production.</p>
        </section>

        <section className={styles.previewPanel}>
          <div className={styles.panelHeading}>
            <div><span>RÉSULTAT</span><h2>Contrôle visuel</h2></div>
            {result ? <button className={styles.download} onClick={downloadResult}><Download size={16} /> Exporter</button> : null}
          </div>
          {!result ? (
            <div className={styles.emptyPreview}><img src="/pilotpaper-dp.svg" alt="" /><strong>DP{contract.dp} en attente</strong><span>Le résultat apparaîtra ici sans ouvrir de nouvelle fenêtre.</span></div>
          ) : (
            <>
              <div className={styles.previewCanvas}>{previewUrl ? <img src={previewUrl} alt={`Résultat DP${contract.dp}`} /> : null}</div>
              <div className={result.inspector.passed ? styles.inspectorPass : styles.inspectorFail}>
                <div className={styles.inspectorTitle}>{result.inspector.passed ? <CheckCircle2 size={20} /> : <TriangleAlert size={20} />}<strong>PilotPaper Inspector</strong><span>{Math.round(result.inspector.score * 100)} %</span></div>
                {result.inspector.checks.map((check) => <p key={check}>✓ {check}</p>)}
                {result.inspector.issues.map((issue) => <p key={issue}>⚠ {issue}</p>)}
              </div>
              <div className={styles.sources}><strong>Sources utilisées</strong>{result.sourceSummary.map((source) => <span key={source}>{source}</span>)}</div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, Layers3, Sparkles, SunMedium, Zap } from "lucide-react";
import type { DPNumber } from "@/lib/pilotpaper-image2-types";
import styles from "./solar-generation-ui.module.css";

export type GenerationJobView = {
  id: string;
  dp: DPNumber;
  status: "queued" | "running" | "done" | "failed";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

function useElapsedLabel(startedAt?: number, active = false) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) return;
    const timer = window.setInterval(() => forceTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  if (!startedAt) return "En attente";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function SolarCore({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? styles.solarCoreCompact : styles.solarCore} aria-hidden="true">
      <div className={styles.sun}><SunMedium /></div>
      <div className={styles.orbit}><span /><span /><span /></div>
      <div className={styles.roofPlane}>
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--panel-index": index } as CSSProperties} />)}
      </div>
      <div className={styles.energyLine} />
      <div className={styles.energyNode}><Zap /></div>
    </div>
  );
}

export function SolarGenerationStage({ job }: { job: GenerationJobView }) {
  const elapsed = useElapsedLabel(job.startedAt, job.status === "running");
  const queued = job.status === "queued";

  return (
    <div className={styles.stage} role="status" aria-live="polite">
      <div className={styles.stageGrid} aria-hidden="true" />
      <div className={styles.stageBeam} aria-hidden="true" />
      <SolarCore />
      <div className={styles.stageCopy}>
        <span className={styles.kicker}>{queued ? "FILE D’ATTENTE" : "GÉNÉRATION RÉELLE EN COURS"}</span>
        <h3>{queued ? `DP${job.dp} attend son tour` : `PilotPaper construit la DP${job.dp}`}</h3>
        <p>{queued ? "La pièce démarrera automatiquement dès que la génération précédente sera terminée." : "Analyse de la source, raisonnement de pose photovoltaïque, génération visuelle et contrôle de cohérence. Aucun faux pourcentage : cet écran disparaît uniquement quand la vraie DP est prête."}</p>
        <div className={styles.liveMeta}>
          <span><Clock3 size={15} /> {elapsed}</span>
          <span><Sparkles size={15} /> PilotPaper Vision</span>
          <span><Layers3 size={15} /> DP{job.dp}</span>
        </div>
      </div>
    </div>
  );
}

export function GenerationDock({ jobs, onOpenDp }: { jobs: GenerationJobView[]; onOpenDp: (dp: DPNumber) => void }) {
  const visibleJobs = useMemo(() => jobs.filter((job) => job.status === "queued" || job.status === "running" || job.status === "done").slice(-8).reverse(), [jobs]);
  const running = jobs.find((job) => job.status === "running");
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const elapsed = useElapsedLabel(running?.startedAt, Boolean(running));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);

  if (!visibleJobs.length) return null;

  const collapsed = !running && !expanded;
  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.dock}
        aria-label="Ouvrir PilotPaper Live"
        title="Ouvrir PilotPaper Live"
        onClick={() => setExpanded(true)}
        style={{ width: 68, height: 68, padding: 7, borderRadius: 20, display: "grid", placeItems: "center", overflow: "hidden" }}
      >
        <div className={styles.dockIcon}><SolarCore compact /></div>
      </button>
    );
  }

  return (
    <aside className={styles.dock} aria-label="Générations PilotPaper">
      <div className={styles.dockGlow} aria-hidden="true" />
      <div className={styles.dockHeader}>
        <div className={styles.dockIcon}><SolarCore compact /></div>
        <div><span>PILOTPAPER LIVE</span><strong>{running ? `DP${running.dp} en cours` : "Générations prêtes"}</strong></div>
        {running ? <b className={styles.liveDot} /> : (
          <button
            type="button"
            aria-label="Réduire PilotPaper Live"
            title="Réduire"
            onClick={() => setExpanded(false)}
            style={{ border: 0, background: "transparent", color: "white", display: "grid", placeItems: "center", cursor: "pointer", padding: 4 }}
          >
            <ChevronDown size={18} />
          </button>
        )}
      </div>

      {running ? (
        <button className={styles.activeJob} onClick={() => onOpenDp(running.dp)}>
          <div><span>GÉNÉRATION ACTIVE</span><strong>DP{running.dp}</strong></div>
          <time>{elapsed}</time>
          <div className={styles.miniPanels} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
        </button>
      ) : null}

      <div className={styles.queueHeader}><span>File d’attente</span><b>{queuedCount}</b></div>
      <div className={styles.jobList}>
        {visibleJobs.filter((job) => job.id !== running?.id).map((job) => (
          <button key={job.id} className={styles.jobRow} onClick={() => onOpenDp(job.dp)}>
            <span className={`${styles.jobState} ${styles[job.status]}`} />
            <strong>DP{job.dp}</strong>
            <small>{job.status === "queued" ? "En attente" : job.status === "done" ? "Prête · ouvrir" : ""}</small>
          </button>
        ))}
      </div>
      {!running ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{ width: "100%", marginTop: 8, border: 0, borderRadius: 10, background: "rgba(255,255,255,.06)", color: "#dcecff", padding: "7px 9px", fontSize: 10, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <ChevronUp size={14} style={{ transform: "rotate(180deg)" }} /> Réduire
        </button>
      ) : null}
    </aside>
  );
}

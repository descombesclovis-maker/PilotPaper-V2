"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, FolderOpen, LoaderCircle, MapPin, Trash2, TriangleAlert } from "lucide-react";
import {
  deleteCompleteDossier,
  ensureCompleteDossierRunning,
  listCompleteDossiers,
  type CompleteDossierRecord,
} from "@/lib/pilotpaper-complete-dossiers";
import styles from "./mes-dossiers.module.css";

function statusMeta(record: CompleteDossierRecord) {
  if (record.status === "ready") return { label: "Prêt", className: styles.ready, icon: CheckCircle2 };
  if (record.status === "error") return { label: "À reprendre", className: styles.error, icon: TriangleAlert };
  return { label: "En génération", className: styles.running, icon: LoaderCircle };
}

export function MesDossiers() {
  const [records, setRecords] = useState<CompleteDossierRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const list = await listCompleteDossiers();
    setRecords(list);
    setLoading(false);
    for (const record of list) {
      if (record.status === "queued" || record.status === "generating") void ensureCompleteDossierRunning(record.id);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1800);
    return () => window.clearInterval(timer);
  }, []);

  async function remove(record: CompleteDossierRecord) {
    if (!window.confirm(`Supprimer « ${record.name} » de Mes dossiers ?`)) return;
    await deleteCompleteDossier(record.id);
    await refresh();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span><FolderOpen /> Déclaration préalable · Mes dossiers</span>
          <h1>Vos dossiers continuent<br />même quand vous partez.</h1>
          <p>Chaque génération complète est sauvegardée ici avec ses huit pièces, son projet, ses photos et son état d’avancement.</p>
        </div>
        <Link className={styles.create} href="/declaration-prealable">Créer une nouvelle DP <ArrowRight /></Link>
      </header>

      {loading ? <div className={styles.loading}><LoaderCircle /> Chargement de Mes dossiers…</div> : records.length === 0 ? <section className={styles.empty}><FolderOpen /><h2>Aucun dossier pour le moment.</h2><p>Votre première génération complète apparaîtra automatiquement ici dès son lancement.</p><Link href="/declaration-prealable">Créer ma première DP</Link></section> : <section className={styles.grid}>
        {records.map((record) => {
          const meta = statusMeta(record);
          const Icon = meta.icon;
          const completed = Object.values(record.pieces).filter((piece) => piece.status === "done").length;
          const preview = Object.values(record.pieces).find((piece) => piece.result?.base64)?.result;
          return <article className={styles.card} key={record.id}>
            <div className={styles.preview}>
              {preview?.base64 ? <img src={`data:${preview.mimeType};base64,${preview.base64}`} alt="Aperçu du dossier" /> : <div className={styles.placeholder}><FolderOpen /></div>}
              <span className={`${styles.status} ${meta.className}`}><Icon className={record.status === "generating" || record.status === "queued" ? styles.spin : ""} /> {meta.label}</span>
              <strong>{completed}/8</strong>
            </div>
            <div className={styles.body}>
              <div className={styles.titleRow}><div><small>Déclaration préalable photovoltaïque</small><h2>{record.name}</h2></div><button type="button" onClick={() => void remove(record)} aria-label="Supprimer le dossier"><Trash2 /></button></div>
              <p><MapPin /> {record.project.address}</p>
              <div className={styles.meta}><span>{record.project.panelCount} panneaux · {record.project.rows} × {record.project.columns}</span><span><Clock3 /> {new Date(record.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span></div>
              <div className={styles.progress}><i style={{ width: `${(completed / 8) * 100}%` }} /></div>
              <Link href={`/declaration-prealable?dossier=${encodeURIComponent(record.id)}`}>{record.status === "ready" ? "Ouvrir le dossier" : record.status === "error" ? "Ouvrir et reprendre" : "Voir la génération"}<ArrowRight /></Link>
            </div>
          </article>;
        })}
      </section>}
    </main>
  );
}

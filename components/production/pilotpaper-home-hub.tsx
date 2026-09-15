"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, CheckCircle2, ClipboardCheck, Construction, FileCheck2, FileText, LandPlot, LockKeyhole, MapPinned, ShieldCheck, Sparkles } from "lucide-react";
import styles from "./pilotpaper-home-hub.module.css";

const dossierTypes = [
  {
    title: "Déclaration préalable",
    description: "Photovoltaïque · dossier complet DP1 à DP8, Cerfa et contrôles de cohérence.",
    icon: FileCheck2,
    active: true,
  },
  { title: "Permis de construire", description: "Construction neuve, extensions et projets soumis à permis.", icon: Construction },
  { title: "PLU & urbanisme", description: "Lecture des règles locales, zonage, prescriptions et servitudes.", icon: MapPinned },
  { title: "Certificat d’urbanisme", description: "Automatisation des demandes d’information et opérationnelles.", icon: LandPlot },
  { title: "Permis d’aménager", description: "Lotissements, divisions, aménagements et créations d’accès.", icon: Building2 },
  { title: "Autorisation de travaux ERP", description: "Accessibilité, sécurité et travaux dans les établissements recevant du public.", icon: ShieldCheck },
  { title: "Déclaration d’ouverture", description: "Préparation automatisée de la déclaration d’ouverture de chantier.", icon: ClipboardCheck },
  { title: "Achèvement & conformité", description: "DAACT et pièces de fin de chantier.", icon: CheckCircle2 },
  { title: "Permis de démolir", description: "Constitution guidée des demandes de démolition.", icon: FileText },
] as const;

const HERO_IMAGE = "https://images.unsplash.com/photo-1711214622639-42bb82a167e8?auto=format&fit=crop&fm=jpg&q=88&w=2400";

export function PilotPaperHomeHub() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} style={{ backgroundImage: `linear-gradient(105deg, rgba(4,14,30,.88) 4%, rgba(8,25,49,.63) 46%, rgba(7,19,35,.22) 76%), url(${HERO_IMAGE})` }}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <span className={styles.kicker}><Sparkles /> PilotPaper · Automation workspace</span>
          <h1>Quel dossier voulez-vous<br />faire disparaître de votre journée&nbsp;?</h1>
          <p>PilotPaper transforme les démarches bâtiment en parcours guidés. La déclaration préalable photovoltaïque est le premier moteur disponible.</p>
          <div className={styles.heroActions}>
            <Link href="/declaration-prealable" className={styles.primaryAction}>Créer ma DP <ArrowUpRight /></Link>
            <Link href="/declaration-prealable/k-par-k" className={styles.secondaryAction}>Ouvrir K-par-k</Link>
          </div>
        </div>
        <div className={styles.heroMeta}>
          <span><i /> 1 moteur actif</span>
          <span>DP photovoltaïque</span>
        </div>
      </section>

      <section className={styles.catalogue}>
        <header>
          <div>
            <span className={styles.sectionKicker}>Bibliothèque de dossiers</span>
            <h2>Choisissez la démarche à automatiser.</h2>
          </div>
          <p>Les moteurs verrouillés sont déjà positionnés dans l’interface. Ils seront activés progressivement sans modifier votre manière de travailler.</p>
        </header>

        <div className={styles.grid}>
          {dossierTypes.map((dossier, index) => {
            const Icon = dossier.icon;
            if (dossier.active) {
              return (
                <article className={`${styles.card} ${styles.activeCard}`} key={dossier.title}>
                  <div className={styles.cardTop}><span className={styles.icon}><Icon /></span><span className={styles.live}>Disponible</span></div>
                  <div><small>0{index + 1}</small><h3>{dossier.title}</h3><p>{dossier.description}</p></div>
                  <div className={styles.cardActions}>
                    <Link href="/declaration-prealable">Créer ma DP <ArrowUpRight /></Link>
                    <Link href="/declaration-prealable/k-par-k">K-par-k</Link>
                  </div>
                </article>
              );
            }
            return (
              <article className={`${styles.card} ${styles.lockedCard}`} key={dossier.title} aria-disabled="true">
                <div className={styles.cardTop}><span className={styles.icon}><Icon /></span><span className={styles.locked}><LockKeyhole /> Bientôt</span></div>
                <div><small>0{index + 1}</small><h3>{dossier.title}</h3><p>{dossier.description}</p></div>
                <span className={styles.future}>Moteur en préparation</span>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

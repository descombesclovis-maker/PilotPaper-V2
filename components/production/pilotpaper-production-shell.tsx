"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, FileText, Home, LockKeyhole, Menu, Settings2, Sparkles, X } from "lucide-react";
import { PilotPaperMark, PilotPaperWordmark } from "@/components/pilotpaper-brand";
import styles from "./pilotpaper-production-shell.module.css";

export const BRANDING_STORAGE_KEY = "pilotpaper-production-branding";
export const INSTALLATION_PREFS_STORAGE_KEY = "pilotpaper-production-installation-prefs";

export type PilotPaperBranding = {
  companyName: string;
  logoDataUrl: string;
  primaryColor: string;
  accentColor: string;
  paperColor: string;
};

export const DEFAULT_BRANDING: PilotPaperBranding = {
  companyName: "",
  logoDataUrl: "",
  primaryColor: "#102a56",
  accentColor: "#36a9cd",
  paperColor: "#f8f8f5",
};

const FUTURE_DOSSIERS = [
  { title: "Demande de construction", create: "Créer ma demande" },
  { title: "PLU & urbanisme", create: "Créer mon dossier PLU" },
  { title: "Certificat d’urbanisme", create: "Créer mon certificat" },
  { title: "Permis d’aménager", create: "Créer mon permis" },
  { title: "Autorisation de travaux ERP", create: "Créer mon autorisation" },
  { title: "Déclaration d’ouverture", create: "Créer ma déclaration" },
  { title: "Achèvement & conformité", create: "Créer mon dossier" },
  { title: "Permis de démolir", create: "Créer mon permis" },
] as const;

function loadBranding() {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    return raw ? { ...DEFAULT_BRANDING, ...JSON.parse(raw) } as PilotPaperBranding : DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

function LockedAction({ children }: { children: ReactNode }) {
  return <span className={styles.disabledLink} aria-disabled="true">{children}<LockKeyhole /></span>;
}

export function PilotPaperProductionShell({ children, fullDp = false }: { children: ReactNode; fullDp?: boolean }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branding, setBranding] = useState<PilotPaperBranding>(DEFAULT_BRANDING);

  useEffect(() => {
    setBranding(loadBranding());
    const handler = () => setBranding(loadBranding());
    window.addEventListener("pilotpaper-branding-updated", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("pilotpaper-branding-updated", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  const theme = {
    "--pp-primary": branding.primaryColor,
    "--pp-accent": branding.accentColor,
    "--pp-paper": branding.paperColor,
  } as CSSProperties;

  return (
    <div className={styles.root} style={theme}>
      <button className={styles.mobileToggle} type="button" onClick={() => setMobileOpen((value) => !value)} aria-label="Ouvrir le menu">
        {mobileOpen ? <X /> : <Menu />}
      </button>
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`}>
        <Link className={styles.brand} href="/">
          {branding.logoDataUrl ? <img className={styles.companyLogo} src={branding.logoDataUrl} alt={branding.companyName || "Logo société"} /> : <PilotPaperMark />}
          <div>
            <PilotPaperWordmark compact />
            <span>{branding.companyName || "Automatisation documentaire"}</span>
          </div>
        </Link>

        <nav className={styles.nav} aria-label="Navigation PilotPaper">
          <details className={styles.accordion} open>
            <summary><span><Home /> Accueil</span><ChevronDown /></summary>
            <div className={styles.accordionContent}>
              <Link className={pathname === "/" ? styles.activeLink : ""} href="/">Aller à la page d’accueil</Link>
            </div>
          </details>

          <details className={styles.accordion} open>
            <summary><span><FileText /> Déclaration préalable</span><ChevronDown /></summary>
            <div className={styles.accordionContent}>
              <Link className={pathname === "/declaration-prealable" ? styles.activeLink : ""} href="/declaration-prealable">Créer ma DP</Link>
              <Link className={pathname.includes("/mes-dossiers") ? styles.activeLink : ""} href="/declaration-prealable/mes-dossiers">Mes dossiers</Link>
              <Link className={pathname.includes("/k-par-k") ? styles.activeLink : ""} href="/declaration-prealable/k-par-k">K-par-k</Link>
            </div>
          </details>

          {FUTURE_DOSSIERS.map((dossier) => <details className={`${styles.accordion} ${styles.futureAccordion}`} key={dossier.title}>
            <summary><span><FileText /> {dossier.title}</span><ChevronDown /></summary>
            <div className={styles.accordionContent}>
              <LockedAction>{dossier.create}</LockedAction>
              <LockedAction>K-par-k</LockedAction>
            </div>
          </details>)}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link className={pathname === "/parametres" ? styles.settingsActive : styles.settings} href="/parametres"><Settings2 /> Paramètres</Link>
          <div className={styles.engineBadge}><Sparkles /><span><strong>PilotPaper Vision</strong><small>Moteur documentaire</small></span><i /></div>
        </div>
      </aside>

      <div className={`${styles.content} ${fullDp ? styles.fullDp : ""}`}>{children}</div>
      {mobileOpen ? <button className={styles.backdrop} type="button" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu" /> : null}
    </div>
  );
}

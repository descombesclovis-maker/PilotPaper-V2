"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, ImagePlus, Paintbrush, RotateCcw, Save, Settings2, SlidersHorizontal, UploadCloud } from "lucide-react";
import { BRANDING_STORAGE_KEY, DEFAULT_BRANDING, INSTALLATION_PREFS_STORAGE_KEY, type PilotPaperBranding } from "./pilotpaper-production-shell";
import styles from "./pilotpaper-settings.module.css";

type InstallationPreferences = {
  moduleReference: string;
  rows: string;
  columns: string;
  orientation: "portrait" | "landscape";
  placement: "centered" | "left" | "right" | "custom";
  panelGapMm: string;
  gutterClearanceMm: string;
  mountingSystem: string;
};

const DEFAULT_INSTALLATION: InstallationPreferences = {
  moduleReference: "TSM-450NEG9R.28",
  rows: "2",
  columns: "6",
  orientation: "portrait",
  placement: "centered",
  panelGapMm: "20",
  gutterClearanceMm: "300",
  mountingSystem: "Surimposition parallèle au rampant",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) } : fallback;
  } catch {
    return fallback;
  }
}

export function PilotPaperSettings() {
  const [branding, setBranding] = useState<PilotPaperBranding>(DEFAULT_BRANDING);
  const [installation, setInstallation] = useState<InstallationPreferences>(DEFAULT_INSTALLATION);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBranding(readJson(BRANDING_STORAGE_KEY, DEFAULT_BRANDING));
    setInstallation(readJson(INSTALLATION_PREFS_STORAGE_KEY, DEFAULT_INSTALLATION));
  }, []);

  const previewStyle = useMemo(() => ({
    "--preview-primary": branding.primaryColor,
    "--preview-accent": branding.accentColor,
    "--preview-paper": branding.paperColor,
  } as React.CSSProperties), [branding]);

  async function onLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 2.5 * 1024 * 1024) {
      alert("Le logo doit faire moins de 2,5 Mo.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Lecture du logo impossible."));
      reader.readAsDataURL(file);
    });
    setBranding((current) => ({ ...current, logoDataUrl: dataUrl }));
    setSaved(false);
  }

  function save() {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding));
    localStorage.setItem(INSTALLATION_PREFS_STORAGE_KEY, JSON.stringify(installation));

    const currentDraft = readJson<Record<string, unknown>>("pilotpaper-image2-draft", {});
    localStorage.setItem("pilotpaper-image2-draft", JSON.stringify({
      ...currentDraft,
      moduleReference: installation.moduleReference,
      rows: installation.rows,
      columns: installation.columns,
      panelCount: String(Math.max(1, Number(installation.rows || 1)) * Math.max(1, Number(installation.columns || 1))),
      orientation: installation.orientation,
      placement: installation.placement,
      interPanelGapMm: installation.panelGapMm,
      gutterClearanceMm: installation.gutterClearanceMm,
    }));

    document.cookie = `pilotpaper_branding=${encodeURIComponent(JSON.stringify({ companyName: branding.companyName, primaryColor: branding.primaryColor, accentColor: branding.accentColor, paperColor: branding.paperColor }))}; path=/; max-age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("pilotpaper-branding-updated"));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2600);
  }

  function reset() {
    setBranding(DEFAULT_BRANDING);
    setInstallation(DEFAULT_INSTALLATION);
    setSaved(false);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span><Settings2 /> Paramètres PilotPaper</span><h1>Votre agence, vos documents.</h1><p>Définissez l’identité graphique des dossiers et les habitudes de pose que PilotPaper doit proposer par défaut.</p></div>
        <button type="button" onClick={save} className={styles.save}>{saved ? <BadgeCheck /> : <Save />}{saved ? "Enregistré" : "Enregistrer"}</button>
      </header>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><span><Paintbrush /></span><div><h2>Identité des DP générées</h2><p>Ces choix deviennent la signature visuelle des dossiers de votre société.</p></div></div>
          <label className={styles.field}><span>Nom de la société</span><input value={branding.companyName} onChange={(event) => { setBranding((current) => ({ ...current, companyName: event.target.value })); setSaved(false); }} placeholder="Nom de votre société" /></label>
          <label className={styles.logoField}>
            <input type="file" accept="image/*" onChange={(event) => void onLogo(event.target.files?.[0])} />
            <span className={styles.logoPreview}>{branding.logoDataUrl ? <img src={branding.logoDataUrl} alt="Logo société" /> : <ImagePlus />}</span>
            <span><strong>{branding.logoDataUrl ? "Remplacer le logo" : "Importer le logo"}</strong><small>PNG, JPEG, WebP ou SVG rasterisé · 2,5 Mo max</small></span>
            <UploadCloud />
          </label>
          <div className={styles.colors}>
            <label><span>Couleur principale</span><div><input type="color" value={branding.primaryColor} onChange={(event) => { setBranding((current) => ({ ...current, primaryColor: event.target.value })); setSaved(false); }} /><code>{branding.primaryColor}</code></div></label>
            <label><span>Accent</span><div><input type="color" value={branding.accentColor} onChange={(event) => { setBranding((current) => ({ ...current, accentColor: event.target.value })); setSaved(false); }} /><code>{branding.accentColor}</code></div></label>
            <label><span>Papier / fond</span><div><input type="color" value={branding.paperColor} onChange={(event) => { setBranding((current) => ({ ...current, paperColor: event.target.value })); setSaved(false); }} /><code>{branding.paperColor}</code></div></label>
          </div>

          <div className={styles.documentPreview} style={previewStyle}>
            <div className={styles.previewHeader}><span>{branding.logoDataUrl ? <img src={branding.logoDataUrl} alt="" /> : <Building2 />}</span><div><strong>{branding.companyName || "Votre société"}</strong><small>Déclaration préalable photovoltaïque</small></div><b>DP4</b></div>
            <div className={styles.previewRule} />
            <div className={styles.previewImage}><div /><div /></div>
            <div className={styles.previewLegend}><i /><span /><span /><span /></div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><span><SlidersHorizontal /></span><div><h2>Préférences d’installation</h2><p>Préremplissage uniquement : chaque dossier reste modifiable avant génération.</p></div></div>
          <label className={styles.field}><span>Référence module favorite</span><input value={installation.moduleReference} onChange={(event) => { setInstallation((current) => ({ ...current, moduleReference: event.target.value })); setSaved(false); }} placeholder="TSM-450NEG9R.28" /></label>
          <div className={styles.twoCols}>
            <label className={styles.field}><span>Rangées par défaut</span><input type="number" min="1" value={installation.rows} onChange={(event) => setInstallation((current) => ({ ...current, rows: event.target.value }))} /></label>
            <label className={styles.field}><span>Colonnes par défaut</span><input type="number" min="1" value={installation.columns} onChange={(event) => setInstallation((current) => ({ ...current, columns: event.target.value }))} /></label>
          </div>
          <div className={styles.twoCols}>
            <label className={styles.field}><span>Orientation</span><select value={installation.orientation} onChange={(event) => setInstallation((current) => ({ ...current, orientation: event.target.value as InstallationPreferences["orientation"] }))}><option value="portrait">Portrait</option><option value="landscape">Paysage</option></select></label>
            <label className={styles.field}><span>Placement préféré</span><select value={installation.placement} onChange={(event) => setInstallation((current) => ({ ...current, placement: event.target.value as InstallationPreferences["placement"] }))}><option value="centered">Centré</option><option value="left">Décalé à gauche</option><option value="right">Décalé à droite</option><option value="custom">Selon dossier</option></select></label>
          </div>
          <div className={styles.twoCols}>
            <label className={styles.field}><span>Jeu entre panneaux (mm)</span><input type="number" min="0" value={installation.panelGapMm} onChange={(event) => setInstallation((current) => ({ ...current, panelGapMm: event.target.value }))} /></label>
            <label className={styles.field}><span>Recul gouttière préféré (mm)</span><input type="number" min="0" value={installation.gutterClearanceMm} onChange={(event) => setInstallation((current) => ({ ...current, gutterClearanceMm: event.target.value }))} /></label>
          </div>
          <label className={styles.field}><span>Système de pose favori</span><input value={installation.mountingSystem} onChange={(event) => setInstallation((current) => ({ ...current, mountingSystem: event.target.value }))} /></label>
          <div className={styles.preferenceNote}><SlidersHorizontal /><p><strong>Ces valeurs ne deviennent jamais des contraintes aveugles.</strong> PilotPaper peut les adapter lorsque la toiture, les obstacles, les règles ou la quantité de panneaux l’imposent.</p></div>
          <button className={styles.reset} type="button" onClick={reset}><RotateCcw /> Rétablir les valeurs PilotPaper</button>
        </section>
      </div>
    </main>
  );
}

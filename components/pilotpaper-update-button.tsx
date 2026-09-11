"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import styles from "./pilotpaper-update-button.module.css";

type DesktopBridge = {
  postMessage(message: string): void;
};

function getDesktopBridge(): DesktopBridge | null {
  const candidate = window as unknown as {
    chrome?: {
      webview?: DesktopBridge;
    };
  };
  return candidate.chrome?.webview ?? null;
}

export function PilotPaperUpdateButton() {
  const [sent, setSent] = useState(false);

  function requestUpdate() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      window.alert("La mise à jour contrôlée est disponible uniquement dans l'application Windows PilotPaper V1.");
      return;
    }
    setSent(true);
    bridge.postMessage("CHECK_UPDATE");
    window.setTimeout(() => setSent(false), 2500);
  }

  return (
    <button
      type="button"
      className={styles.button}
      onClick={requestUpdate}
      title="Vérifier manuellement si une nouvelle V1 validée est disponible"
    >
      <RefreshCw className={sent ? styles.spin : undefined} size={16} />
      {sent ? "Vérification…" : "Mettre à jour PilotPaper"}
    </button>
  );
}

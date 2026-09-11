"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import styles from "./pilotpaper-update-button.module.css";

type DesktopBridge = {
  postMessage(message: string): void;
  addEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
};

type UpdateStatus = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "error";

type UpdateMessage = {
  type?: string;
  status?: UpdateStatus;
  message?: string;
};

function getDesktopBridge(): DesktopBridge | null {
  const candidate = window as unknown as {
    chrome?: {
      webview?: DesktopBridge;
    };
  };
  return candidate.chrome?.webview ?? null;
}

function parseUpdateMessage(data: unknown): UpdateMessage | null {
  if (typeof data === "object" && data !== null) return data as UpdateMessage;
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as UpdateMessage;
  } catch {
    return null;
  }
}

export function PilotPaperUpdateButton() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [message, setMessage] = useState("Mettre à jour PilotPaper");

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.addEventListener) return;

    const listener = (event: { data: unknown }) => {
      const payload = parseUpdateMessage(event.data);
      if (payload?.type !== "pilotpaper-update-status" || !payload.status) return;
      setStatus(payload.status);
      setMessage(payload.message || "Mise à jour PilotPaper");
    };

    bridge.addEventListener("message", listener);
    return () => bridge.removeEventListener?.("message", listener);
  }, []);

  function requestUpdate() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setStatus("error");
      setMessage("Updater indisponible hors application Windows");
      return;
    }
    setStatus("checking");
    setMessage("Vérification de la dernière V1…");
    bridge.postMessage("CHECK_UPDATE");
  }

  const busy = ["checking", "downloading", "installing"].includes(status);
  const success = status === "current";
  const failed = status === "error";

  return (
    <button
      type="button"
      className={`${styles.button} ${success ? styles.success : ""} ${failed ? styles.error : ""}`}
      onClick={requestUpdate}
      disabled={busy}
      title="Vérifier manuellement si une nouvelle V1 validée est disponible"
      aria-live="polite"
    >
      {success ? <CheckCircle2 size={16} /> : failed ? <TriangleAlert size={16} /> : <RefreshCw className={busy ? styles.spin : undefined} size={16} />}
      {message}
    </button>
  );
}

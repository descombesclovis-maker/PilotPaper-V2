"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CircleCheck,
  FileText,
  FlaskConical,
  KeyRound,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

const dpPieces = [
  { id: "DP1", title: "Plan de situation" },
  { id: "DP2", title: "Plan de masse" },
  { id: "DP3", title: "Plan en coupe" },
  { id: "DP4", title: "Façades et toitures" },
  { id: "DP5", title: "Aspect extérieur" },
  { id: "DP6", title: "Insertion du projet" },
  { id: "DP7", title: "Photographie proche" },
  { id: "DP8", title: "Photographie lointaine" },
] as const;

type DpId = (typeof dpPieces)[number]["id"];
type DpVisualState = "blocked" | "incomplete" | "review" | "verified" | "neutral";

type AiHealth = {
  status?: "ready" | "incomplete";
  engineVersion?: string;
  mode?: string;
  models?: string[];
  missing?: string[];
};

function readDpState(sheet: Element): DpVisualState {
  if (sheet.classList.contains("state-verified")) return "verified";
  if (sheet.classList.contains("state-review")) return "review";
  if (sheet.classList.contains("state-incomplete")) return "incomplete";
  if (sheet.classList.contains("state-blocked")) return "blocked";
  return "neutral";
}

function sameStateMap(a: Record<string, DpVisualState>, b: Record<string, DpVisualState>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function nativeLabTrigger() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes("Laboratoire DP"),
  );
}

export function PilotPaperExperienceLayer() {
  const [sidebarMenu, setSidebarMenu] = useState<HTMLElement | null>(null);
  const [documentStage, setDocumentStage] = useState<HTMLElement | null>(null);
  const [aiCard, setAiCard] = useState<HTMLElement | null>(null);
  const [selectedDp, setSelectedDp] = useState<DpId | null>(null);
  const [dpStates, setDpStates] = useState<Record<string, DpVisualState>>({});
  const [aiHealth, setAiHealth] = useState<AiHealth | null>(null);
  const [aiReachable, setAiReachable] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("pp-experience-ready");

    const syncInterface = () => {
      const menus = Array.from(
        document.querySelectorAll<HTMLElement>(".app-sidebar [data-sidebar='menu']"),
      );
      setSidebarMenu((current) => (current === (menus[0] ?? null) ? current : (menus[0] ?? null)));

      const nextDocumentStage = document.querySelector<HTMLElement>(".document-stage");
      setDocumentStage((current) => (current === nextDocumentStage ? current : nextDocumentStage));

      const nextAiCard = document.querySelector<HTMLElement>(".ai-card");
      setAiCard((current) => (current === nextAiCard ? current : nextAiCard));

      const sidebarButtons = Array.from(
        document.querySelectorAll<HTMLElement>(".app-sidebar [data-sidebar='menu-button']"),
      );
      for (const button of sidebarButtons) {
        const label = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const item = button.closest<HTMLElement>("[data-sidebar='menu-item']");
        if (["Nouveau dossier", "Dossiers", "Moteur IA local", "Référentiel", "Paramètres"].some((value) => label.includes(value))) {
          item?.classList.add("pp-hidden-nav-item");
        }
        if (label.includes("Tableau de bord")) {
          button.setAttribute("data-active", "true");
          button.addEventListener(
            "click",
            () => window.scrollTo({ top: 0, behavior: "smooth" }),
            { once: true },
          );
        }
      }

      for (const label of Array.from(document.querySelectorAll<HTMLElement>(".app-sidebar [data-sidebar='group-label']"))) {
        if (label.textContent?.trim() === "Contrôle") {
          label.closest<HTMLElement>("[data-sidebar='group']")?.classList.add("pp-hidden-sidebar-group");
        }
      }
      document.querySelector<HTMLElement>(".app-sidebar [data-sidebar='footer']")?.classList.add("pp-hidden-sidebar-footer");

      const trigger = nativeLabTrigger();
      trigger?.classList.add("pp-native-lab-trigger");

      const legacyStack = document.querySelector<HTMLElement>(".document-stack");
      if (legacyStack) {
        const nextStates: Record<string, DpVisualState> = {};
        for (const sheet of Array.from(legacyStack.querySelectorAll<HTMLElement>(".document-sheet"))) {
          const id = sheet.querySelector("span")?.textContent?.trim();
          if (id) nextStates[id] = readDpState(sheet);
        }
        setDpStates((current) => (sameStateMap(current, nextStates) ? current : nextStates));
      }
    };

    syncInterface();
    const observer = new MutationObserver(syncInterface);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    const captureDirection = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button) return;

      if (button.classList.contains("step-item")) {
        const requested = Number(button.querySelector("small")?.textContent?.replace(/\D/g, ""));
        const active = Number(document.querySelector(".step-item.is-active small")?.textContent?.replace(/\D/g, ""));
        if (Number.isFinite(requested) && Number.isFinite(active)) {
          document.documentElement.dataset.turnDirection = requested < active ? "backward" : "forward";
        }
        return;
      }

      const text = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.includes("Retour")) document.documentElement.dataset.turnDirection = "backward";
      if (text.includes("Continuer")) document.documentElement.dataset.turnDirection = "forward";
    };

    document.addEventListener("click", captureDirection, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", captureDirection, true);
      document.documentElement.classList.remove("pp-experience-ready");
      delete document.documentElement.dataset.turnDirection;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/dp-ai/health", { cache: "no-store" });
        const payload = (await response.json()) as AiHealth;
        if (!active) return;
        setAiHealth(payload);
        setAiReachable(true);
      } catch {
        if (!active) return;
        setAiHealth(null);
        setAiReachable(false);
      }
    };

    void checkHealth();
    const timer = window.setInterval(() => void checkHealth(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedDp) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedDp(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDp]);

  const selectedPiece = useMemo(
    () => dpPieces.find((piece) => piece.id === selectedDp) ?? null,
    [selectedDp],
  );

  const aiStatus = useMemo(() => {
    if (!aiReachable) {
      return {
        tone: "error" as const,
        icon: TriangleAlert,
        title: "Moteur intégré indisponible",
        detail: "PilotPaper ne répond pas encore sur ce poste.",
      };
    }
    const missingKey = aiHealth?.missing?.includes("OPENAI_API_KEY");
    if (missingKey) {
      return {
        tone: "warning" as const,
        icon: KeyRound,
        title: "Clé API requise",
        detail: "Aucun programme IA séparé : la clé doit simplement être chargée par PilotPaper.",
      };
    }
    if (aiHealth?.status === "ready") {
      return {
        tone: "ready" as const,
        icon: CircleCheck,
        title: "Moteur IA prêt",
        detail: `${aiHealth.engineVersion ?? "DP-AI-FIRST"} · moteur intégré au lancement`,
      };
    }
    return {
      tone: "warning" as const,
      icon: Sparkles,
      title: "Configuration IA incomplète",
      detail: "PilotPaper est lancé, mais une configuration du moteur manque.",
    };
  }, [aiHealth, aiReachable]);

  function openLab() {
    const trigger = nativeLabTrigger();
    if (!trigger) {
      toast.error("Le laboratoire DP n'est pas disponible dans cette session.");
      return;
    }
    trigger.click();
  }

  const labPortal = sidebarMenu
    ? createPortal(
        <li className="pp-lab-menu-item" data-sidebar="menu-item">
          <button type="button" className="pp-lab-menu-button" onClick={openLab}>
            <FlaskConical />
            <span>K-par-k</span>
            <small>LAB</small>
          </button>
        </li>,
        sidebarMenu,
      )
    : null;

  const deckPortal = documentStage
    ? createPortal(
        <div className="pp-document-deck" aria-label="Sélection des pièces DP1 à DP8">
          {dpPieces.map((piece, index) => {
            const state = dpStates[piece.id] ?? "neutral";
            return (
              <button
                key={piece.id}
                type="button"
                className={`pp-document-sheet state-${state}`}
                style={{ "--dp-index": index } as CSSProperties}
                onClick={() => setSelectedDp(piece.id)}
                aria-label={`Afficher ${piece.id} — ${piece.title}`}
              >
                <span className="pp-sheet-code">{piece.id}</span>
                <span className="pp-sheet-title">{piece.title}</span>
                <span className="pp-sheet-lines" aria-hidden="true" />
                <span className="pp-sheet-edge" aria-hidden="true" />
              </button>
            );
          })}
          <div className="pp-deck-shadow" aria-hidden="true" />
          <p className="pp-deck-hint">Survolez puis sélectionnez une feuille</p>
        </div>,
        documentStage,
      )
    : null;

  const StatusIcon = aiStatus.icon;
  const aiPortal = aiCard
    ? createPortal(
        <div className={`pp-ai-runtime pp-ai-runtime-${aiStatus.tone}`}>
          <StatusIcon />
          <span>
            <strong>{aiStatus.title}</strong>
            <small>{aiStatus.detail}</small>
          </span>
        </div>,
        aiCard,
      )
    : null;

  return (
    <>
      {labPortal}
      {deckPortal}
      {aiPortal}

      {selectedPiece ? (
        <div className="pp-dp-preview-backdrop" role="presentation" onMouseDown={() => setSelectedDp(null)}>
          <article
            className={`pp-dp-preview-sheet state-${dpStates[selectedPiece.id] ?? "neutral"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pp-dp-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" className="pp-dp-preview-close" onClick={() => setSelectedDp(null)} aria-label="Fermer la pièce">
              <X />
            </button>
            <div className="pp-dp-preview-head">
              <span>{selectedPiece.id}</span>
              <small>Pièce du dossier PilotPaper</small>
            </div>
            <h2 id="pp-dp-preview-title">{selectedPiece.title}</h2>
            <div className="pp-dp-preview-rule" />
            <div className="pp-dp-preview-body" aria-hidden="true">
              <span />
              <span />
              <span className="short" />
              <div className="pp-dp-preview-visual">
                <FileText />
                <span>{selectedPiece.id}</span>
              </div>
              <span />
              <span className="medium" />
            </div>
            <div className="pp-dp-preview-foot">
              <span>Prévisualisation de travail</span>
              <strong>Cliquez sur une autre feuille pour changer de pièce</strong>
            </div>
          </article>
        </div>
      ) : null}
    </>
  );
}

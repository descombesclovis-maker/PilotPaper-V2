"use client";

import { useEffect, useState, type ComponentType } from "react";

function migrateMinimalDraft() {
  const key = "pilotpaper-image2-draft";
  try {
    const current = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    const next = {
      ...current,
      placement: "centered",
      instructions: "",
      roofWidthMm: "",
      roofSlopeLengthMm: "",
      roofSlopeDeg: "",
      gutterClearanceMm: "300",
      interPanelGapMm: "20",
    };
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    localStorage.setItem(key, JSON.stringify({
      placement: "centered",
      instructions: "",
      roofWidthMm: "",
      roofSlopeLengthMm: "",
      roofSlopeDeg: "",
      gutterClearanceMm: "300",
      interPanelGapMm: "20",
    }));
  }
}

function sanitizeVisibleProviderWording(root: ParentNode = document) {
  const workspace = root.querySelector?.("[data-pilotpaper-image2-workbench]") ?? document.querySelector("[data-pilotpaper-image2-workbench]");
  if (!workspace) return;
  const walker = document.createTreeWalker(workspace, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const original = node.nodeValue ?? "";
    const cleaned = original
      .replace(/chatgpt\s*image-?2/gi, "PilotPaper Vision")
      .replace(/chatgpt\s*image/gi, "PilotPaper Vision")
      .replace(/chatgpt/gi, "PilotPaper")
      .replace(/gpt-image-2/gi, "moteur visuel")
      .replace(/openai/gi, "PilotPaper")
      .replace(/image-2/gi, "Vision");
    if (cleaned !== original) node.nodeValue = cleaned;
  }
}

export function DpPieceWorkbenchClient() {
  const [Workbench, setWorkbench] = useState<ComponentType | null>(null);

  useEffect(() => {
    migrateMinimalDraft();

    const observer = new MutationObserver(() => sanitizeVisibleProviderWording());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    void import("@/components/dp-piece-workbench").then((module) => {
      setWorkbench(() => module.DpPieceWorkbench);
      requestAnimationFrame(() => sanitizeVisibleProviderWording());
    });

    return () => observer.disconnect();
  }, []);

  return Workbench ? <Workbench /> : null;
}

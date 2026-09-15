"use client";

import { useEffect } from "react";
import { WorkspaceClient } from "@/app/workspace-client";
import { BRANDING_STORAGE_KEY, DEFAULT_BRANDING, type PilotPaperBranding } from "./pilotpaper-production-shell";

type CurrentUser = {
  displayName: string;
  email: string | null;
};

function readBranding(): PilotPaperBranding {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    return raw ? { ...DEFAULT_BRANDING, ...JSON.parse(raw) } as PilotPaperBranding : DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

async function normalizeLogoForPdf(dataUrl: string) {
  if (!dataUrl || typeof document === "undefined") return "";
  if (!dataUrl.startsWith("data:image/")) return "";
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("Logo illisible"));
      node.src = dataUrl;
    });
    const maxWidth = 360;
    const maxHeight = 150;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const normalized = canvas.toDataURL("image/png");
    return normalized.length <= 780_000 ? normalized : "";
  } catch {
    return "";
  }
}

export function ProductionDpWorkspace({ currentUser }: { currentUser: CurrentUser }) {
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    const productionFetch: typeof window.fetch = async (input, init) => {
      const inputUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const isProductionGeneration = method === "POST" && /\/api\/projects\/[^/?]+\/generate(?:\?.*)?$/.test(inputUrl);

      if (!isProductionGeneration) return nativeFetch(input, init);

      const branding = readBranding();
      const logoDataUrl = await normalizeLogoForPdf(branding.logoDataUrl);
      const brandedUrl = inputUrl.replace(/\/generate(\?.*)?$/, "/generate-branded$1");
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("Content-Type", "application/json");

      return nativeFetch(brandedUrl, {
        ...init,
        method: "POST",
        headers,
        body: JSON.stringify({
          branding: {
            ...branding,
            logoDataUrl,
          },
        }),
      });
    };

    window.fetch = productionFetch;
    return () => {
      if (window.fetch === productionFetch) window.fetch = nativeFetch;
    };
  }, []);

  return <WorkspaceClient currentUser={currentUser} />;
}

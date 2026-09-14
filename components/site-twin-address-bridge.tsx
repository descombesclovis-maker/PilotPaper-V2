"use client";

import { useEffect, useRef } from "react";

const DRAFT_KEY = "pilotpaper-v1-k-par-k-draft";

function currentAddress() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { address?: unknown };
    return String(parsed.address ?? "").trim();
  } catch {
    return "";
  }
}

export function SiteTwinAddressBridge() {
  const lastRequestedAddress = useRef("");
  const inFlightAddress = useRef("");

  useEffect(() => {
    let stopped = false;

    async function synchronize() {
      const address = currentAddress();
      if (address.length < 8) return;
      if (address === lastRequestedAddress.current || address === inFlightAddress.current) return;

      inFlightAddress.current = address;
      try {
        const response = await fetch("/api/site-twin-v2/reconstruct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        });
        if (!stopped && response.ok) lastRequestedAddress.current = address;
      } catch {
        // Site Twin pre-warming must never block the user's form. The normal
        // generation path will surface a precise recoverable error if needed.
      } finally {
        if (inFlightAddress.current === address) inFlightAddress.current = "";
      }
    }

    const initialTimer = window.setTimeout(() => { void synchronize(); }, 900);
    const interval = window.setInterval(() => { void synchronize(); }, 1200);
    return () => {
      stopped = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

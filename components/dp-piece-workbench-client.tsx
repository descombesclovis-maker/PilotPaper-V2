"use client";

import { useEffect, useState, type ComponentType } from "react";

export function DpPieceWorkbenchClient() {
  const [Workbench, setWorkbench] = useState<ComponentType | null>(null);

  useEffect(() => {
    // The new Image-2 V1 must never treat old sample roof dimensions as real measurements.
    // On the first launch of this architecture, pre-seed these optional DP3 values as empty.
    const key = "pilotpaper-image2-draft";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({
        roofWidthMm: "",
        roofSlopeLengthMm: "",
        roofSlopeDeg: "",
      }));
    }

    void import("@/components/dp-piece-workbench").then((module) => {
      setWorkbench(() => module.DpPieceWorkbench);
    });
  }, []);

  return Workbench ? <Workbench /> : null;
}

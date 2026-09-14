"use client";

import { useState, type MouseEvent } from "react";

export type RoofFaceChoice = {
  id: string;
  label: string;
  displayFaceId?: string;
  stableKey?: string;
  originalSegmentIndex?: number;
  buildingId?: string;
  centerNormalized: { x: number; y: number };
  areaMeters2?: number;
  panelCellCount?: number;
  pitchDegrees?: number;
  azimuthDegrees?: number;
  compatible?: boolean;
  incompatibilityReason?: string;
};

type RoofFaceSelectorProps = {
  imageUrl: string;
  faces: RoofFaceChoice[];
  selectedFaceIds: string[];
  onChange: (faceIds: string[]) => void;
  disabled?: boolean;
};

export function RoofFaceSelector({
  imageUrl,
  faces,
  selectedFaceIds,
  onChange,
  disabled = false,
}: RoofFaceSelectorProps) {
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null);
  const selected = new Set(selectedFaceIds);
  const selectedFaces = faces.filter((face) => selected.has(face.id));
  const selectedIncompatibleCount = selectedFaces.filter((face) => face.compatible === false).length;

  function nearestFaceAt(x: number, y: number, rect: DOMRect) {
    const aspect = rect.width / rect.height;
    const ranked = faces
      .map((face) => {
        const dx = (face.centerNormalized.x - x) * aspect;
        const dy = face.centerNormalized.y - y;
        return { face, distance: Math.hypot(dx, dy) };
      })
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    // Technical face centres are never rendered. They are only an internal aid
    // to associate the user's real click with the closest physical roof face.
    return best && best.distance <= 0.30 ? best.face : undefined;
  }

  function onImageClick(event: MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setLastClick({ x, y });

    const face = nearestFaceAt(x, y, rect);
    if (!face) return;
    const next = new Set(selectedFaceIds);
    if (next.has(face.id)) next.delete(face.id);
    else next.add(face.id);
    onChange(faces.filter((candidate) => next.has(candidate.id)).map((candidate) => candidate.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Cliquez directement sur le ou les pans que vous souhaitez équiper</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Aucun numéro, cercle technique ou centre de pan n&apos;est affiché. Votre clic sur la toiture représente votre intention ; PilotPaper associe ce clic au pan physique le plus proche en interne.
          </p>
        </div>
        <div className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600">
          {selectedFaces.length
            ? `${selectedFaces.length} pan${selectedFaces.length > 1 ? "s" : ""} sélectionné${selectedFaces.length > 1 ? "s" : ""}`
            : "Aucun pan sélectionné"}
        </div>
      </div>

      <div
        className={`relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm ${disabled ? "cursor-wait" : "cursor-crosshair"}`}
        onClick={onImageClick}
        role="group"
        aria-label="Vue aérienne interactive : cliquez directement sur la zone exacte de toiture à équiper"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Vue aérienne IGN centrée sur la parcelle du projet"
          className="block h-auto w-full select-none"
          draggable={false}
        />

        {lastClick ? (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${lastClick.x * 100}%`, top: `${lastClick.y * 100}%` }}
            aria-hidden="true"
          >
            <div className="relative size-7 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(8,145,178,.95)]">
              <span className="absolute left-1/2 top-[-7px] h-10 w-px -translate-x-1/2 bg-cyan-700" />
              <span className="absolute left-[-7px] top-1/2 h-px w-10 -translate-y-1/2 bg-cyan-700" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-600">
        {selectedFaces.length === 0 ? (
          <>Cliquez sur la zone de toiture que vous voulez réellement équiper. Si PilotPaper ne peut pas associer ce clic à un pan physique avec assez de confiance, il doit refuser la sélection plutôt que deviner.</>
        ) : selectedIncompatibleCount > 0 ? (
          <>{selectedIncompatibleCount} pan{selectedIncompatibleCount > 1 ? "s" : ""} sélectionné{selectedIncompatibleCount > 1 ? "s sont" : " est"} actuellement incompatible{selectedIncompatibleCount > 1 ? "s" : ""} avec la matrice demandée. La sélection reste conservée pour expliquer le conflit au lieu de masquer le toit.</>
        ) : (
          <>Zone enregistrée. Recliquez sur le même pan pour le retirer, ou cliquez sur un autre pan si le projet doit être réparti.</>
        )}
      </div>
    </div>
  );
}

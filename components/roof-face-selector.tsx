"use client";

import type { MouseEvent } from "react";

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
  const selected = new Set(selectedFaceIds);
  const selectedFaces = faces.filter((face) => selected.has(face.id));
  const selectedIncompatibleCount = selectedFaces.filter((face) => face.compatible === false).length;

  function toggle(face: RoofFaceChoice) {
    if (disabled) return;
    const next = new Set(selectedFaceIds);
    if (next.has(face.id)) next.delete(face.id);
    else next.add(face.id);
    onChange(faces.filter((candidate) => next.has(candidate.id)).map((candidate) => candidate.id));
  }

  function closestFace(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const aspect = rect.width / rect.height;
    const ranked = faces
      .map((face) => {
        const dx = (face.centerNormalized.x - x) * aspect;
        const dy = face.centerNormalized.y - y;
        return { face, distance: Math.hypot(dx, dy) };
      })
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    return best && best.distance <= 0.24 ? best.face : undefined;
  }

  function onImageClick(event: MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const face = closestFace(event);
    if (face) toggle(face);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Cliquez sur le ou les pans que vous souhaitez équiper</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Aucun numéro n&apos;est affiché sur la toiture. Cliquez directement sur les zones de toit concernées ; recliquez pour désélectionner.
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
        aria-label="Vue aérienne interactive : cliquez directement sur le ou les pans de toiture à équiper"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Vue aérienne IGN centrée sur la parcelle du projet"
          className="block h-auto w-full select-none"
          draggable={false}
        />

        {faces.map((face) => {
          const isSelected = selected.has(face.id);
          return (
            <button
              key={face.stableKey ?? face.id}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`${isSelected ? "Désélectionner" : "Sélectionner"} un pan de toiture${face.compatible === false ? " actuellement incompatible avec la configuration" : ""}`}
              title={face.compatible === false
                ? face.incompatibilityReason || "Ce pan est détecté mais la configuration demandée n'y tient pas actuellement."
                : "Cliquez pour sélectionner ce pan"}
              onClick={(event) => {
                event.stopPropagation();
                toggle(face);
              }}
              className={`absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all focus:outline-none focus:ring-4 focus:ring-cyan-200 ${
                isSelected
                  ? "border-white bg-cyan-500/20 ring-4 ring-cyan-300/80 shadow-[0_0_0_2px_rgba(8,145,178,.9)]"
                  : "border-transparent bg-transparent hover:border-white/90 hover:bg-cyan-300/15 hover:ring-2 hover:ring-cyan-300/70"
              }`}
              style={{
                left: `${Math.max(3, Math.min(97, face.centerNormalized.x * 100))}%`,
                top: `${Math.max(4, Math.min(96, face.centerNormalized.y * 100))}%`,
              }}
            >
              <span className="sr-only">Pan de toiture</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-600">
        {selectedFaces.length === 0 ? (
          <>Sélectionnez d&apos;abord la zone que vous voulez réellement équiper. PilotPaper vérifiera ensuite si la quantité demandée tient sur ce ou ces pans.</>
        ) : selectedIncompatibleCount > 0 ? (
          <>{selectedIncompatibleCount} pan{selectedIncompatibleCount > 1 ? "s" : ""} sélectionné{selectedIncompatibleCount > 1 ? "s sont" : " est"} actuellement incompatible{selectedIncompatibleCount > 1 ? "s" : ""} avec la matrice demandée. La sélection reste conservée afin que PilotPaper puisse expliquer ou répartir le calepinage au lieu de masquer le toit.</>
        ) : (
          <>Sélection enregistrée. Vous pouvez choisir plusieurs pans si le projet doit être réparti sur plusieurs zones de toiture.</>
        )}
      </div>
    </div>
  );
}

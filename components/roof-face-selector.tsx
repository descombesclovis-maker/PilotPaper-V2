"use client";

import { Check, MousePointer2, SunMedium } from "lucide-react";

export type RoofFaceChoice = {
  id: string;
  label?: string;
  originalSegmentIndex?: number;
  centerNormalized: { x: number; y: number };
  areaMeters2?: number;
  panelCellCount?: number;
  pitchDegrees?: number;
  azimuthDegrees?: number;
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

  function toggle(faceId: string) {
    if (disabled) return;
    if (selected.has(faceId)) {
      onChange(selectedFaceIds.filter((id) => id !== faceId));
      return;
    }
    onChange([...selectedFaceIds, faceId]);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Choisissez le ou les pans autorisés</p>
          <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">Cliquez directement sur les repères de toiture. PilotPaper utilisera le minimum de pans nécessaire.</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold text-zinc-600">
          <MousePointer2 className="size-3" /> {selectedFaceIds.length} sélectionné{selectedFaceIds.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="relative aspect-[7/5] overflow-hidden bg-zinc-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Vue aérienne rapprochée de la toiture" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/10 to-transparent" />
        {faces.map((face) => {
          const active = selected.has(face.id);
          const left = `${Math.max(2, Math.min(98, face.centerNormalized.x * 100))}%`;
          const top = `${Math.max(2, Math.min(98, face.centerNormalized.y * 100))}%`;
          return (
            <button
              key={face.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(face.id)}
              title={`${face.label ?? face.id}${face.pitchDegrees != null ? ` · pente ${face.pitchDegrees.toFixed(0)}°` : ""}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2.5 py-2 text-left shadow-lg backdrop-blur-md transition-all ${
                active
                  ? "scale-105 border-emerald-300 bg-emerald-500/92 text-white ring-4 ring-emerald-300/30"
                  : "border-white/70 bg-zinc-950/75 text-white hover:scale-105 hover:bg-zinc-950/90"
              } ${disabled ? "cursor-wait opacity-60" : "cursor-pointer"}`}
              style={{ left, top }}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold">
                {active ? <Check className="size-3.5" /> : <SunMedium className="size-3.5" />}
                {face.label ?? face.id}
              </span>
              <span className="mt-1 block whitespace-nowrap text-[8px] opacity-80">
                {face.areaMeters2 != null ? `${face.areaMeters2.toFixed(1)} m²` : "surface n.c."}
                {face.panelCellCount != null ? ` · ${face.panelCellCount} emplacements` : ""}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3">
        {faces.map((face) => {
          const active = selected.has(face.id);
          return (
            <button
              key={`legend-${face.id}`}
              type="button"
              disabled={disabled}
              onClick={() => toggle(face.id)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold transition ${
                active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {active ? "✓ " : ""}{face.label ?? face.id}
              {face.pitchDegrees != null ? ` · ${face.pitchDegrees.toFixed(0)}°` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

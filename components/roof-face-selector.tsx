"use client";

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
  const selectedFace = selectedFaceIds.length ? faces.find((face) => selected.has(face.id)) : undefined;
  const compatibleCount = faces.filter((face) => face.compatible !== false).length;

  function visibleFaceId(face: RoofFaceChoice) {
    return (face.displayFaceId ?? face.label.replace(/^Pan\s+/i, "").trim()) || "?";
  }

  function select(face: RoofFaceChoice) {
    if (disabled || face.compatible === false) return;
    onChange(selected.has(face.id) ? [] : [face.id]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Choisissez le pan à équiper</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Tous les pans physiques détectés restent visibles. Les pans incompatibles avec la configuration demandée sont grisés, jamais supprimés.
          </p>
        </div>
        <div className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600">
          {selectedFace
            ? `${selectedFace.label} sélectionné`
            : `${faces.length} pan${faces.length > 1 ? "s" : ""} physique${faces.length > 1 ? "s" : ""} · ${compatibleCount} compatible${compatibleCount > 1 ? "s" : ""}`}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Vue aérienne IGN de la maison cible avec tous les pans physiques détectés"
          className="block h-auto w-full select-none"
          draggable={false}
        />
        {faces.map((face) => {
          const isSelected = selected.has(face.id);
          const isCompatible = face.compatible !== false;
          const title = isCompatible
            ? `${face.label}${face.areaMeters2 ? ` · ${face.areaMeters2.toFixed(1)} m²` : ""}`
            : `${face.label} · incompatible${face.incompatibilityReason ? ` · ${face.incompatibilityReason}` : ""}`;
          return (
            <button
              key={face.stableKey ?? face.id}
              type="button"
              disabled={disabled || !isCompatible}
              aria-pressed={isSelected}
              aria-label={isCompatible
                ? `${isSelected ? "Désélectionner" : "Sélectionner"} ${face.label}`
                : `${face.label} incompatible avec la configuration demandée`}
              title={title}
              onClick={() => select(face)}
              className={`absolute grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-sm font-black shadow-lg transition-all focus:outline-none focus:ring-4 focus:ring-cyan-200 ${
                isSelected
                  ? "scale-110 border-white bg-cyan-600 text-white ring-4 ring-cyan-200/70"
                  : isCompatible
                    ? "border-white bg-zinc-950/85 text-white hover:scale-110 hover:bg-cyan-600"
                    : "cursor-not-allowed border-white bg-zinc-400/85 text-white opacity-75"
              }`}
              style={{
                left: `${Math.max(3, Math.min(97, face.centerNormalized.x * 100))}%`,
                top: `${Math.max(4, Math.min(96, face.centerNormalized.y * 100))}%`,
              }}
            >
              {visibleFaceId(face)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {faces.map((face) => {
          const isSelected = selected.has(face.id);
          const isCompatible = face.compatible !== false;
          return (
            <button
              key={face.stableKey ?? face.id}
              type="button"
              disabled={disabled || !isCompatible}
              onClick={() => select(face)}
              title={!isCompatible ? face.incompatibilityReason || "Configuration incompatible avec ce pan." : undefined}
              className={`rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
                isSelected
                  ? "border-cyan-600 bg-cyan-50 text-cyan-800"
                  : isCompatible
                    ? "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                    : "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
              }`}
            >
              {face.label}
              {face.areaMeters2 ? ` · ${face.areaMeters2.toFixed(1)} m²` : ""}
              {face.pitchDegrees != null ? ` · ${face.pitchDegrees.toFixed(0)}°` : ""}
              {!isCompatible ? " · incompatible" : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

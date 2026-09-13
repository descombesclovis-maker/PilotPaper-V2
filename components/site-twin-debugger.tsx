"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

type Point = { x: number; y: number };
type Face = {
  id: string;
  displayLabel: string;
  areaM2: number;
  slopeDeg: number;
  azimuthDeg: number;
  confidence: number;
  polygonLocalM: Point[];
};
type Module = { moduleIndex: number; faceId: string; polygonLocalM: Point[] };
type Eligibility = { faceId: string; fits: boolean; maximumPanelCount: number; resolvedGutterClearanceMm?: number; reasons: string[] };
type SiteTwinLayoutResponse = {
  siteTwin?: {
    id: string;
    revision: number;
    normalizedAddress: string;
    parcelReference: string;
    targetBuildingIds: string[];
    confidence: number;
    sources: Record<string, unknown>;
    roof: { faces: Face[] };
  };
  layout?: { selectedFaceIds: string[]; eligibility: Eligibility[]; modules: Module[] };
  physicalFaceCount?: number;
  compatibleFaceCount?: number;
  error?: string;
  code?: string;
  details?: unknown;
};

function svgGeometry(faces: Face[], modules: Module[]) {
  const points = [...faces.flatMap((face) => face.polygonLocalM), ...modules.flatMap((module) => module.polygonLocalM)];
  if (!points.length) return undefined;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min(520 / width, 320 / height);
  const project = (point: Point) => ({
    x: 30 + (point.x - minX) * scale,
    y: 350 - (30 + (point.y - minY) * scale),
  });
  const polygon = (values: Point[]) => values.map(project).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return { polygon, viewBox: "0 0 580 380" };
}

export function SiteTwinDebugger() {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<SiteTwinLayoutResponse>();
  const [loading, setLoading] = useState(false);
  const faces = useMemo(() => result?.siteTwin?.roof.faces ?? [], [result?.siteTwin?.roof.faces]);
  const modules = useMemo(() => result?.layout?.modules ?? [], [result?.layout?.modules]);
  const drawing = useMemo(() => svgGeometry(faces, modules), [faces, modules]);
  const eligibility = new Map((result?.layout?.eligibility ?? []).map((entry) => [entry.faceId, entry]));
  const selected = new Set(result?.layout?.selectedFaceIds ?? []);

  async function reconstruct(forceSiteTwin = false) {
    setLoading(true);
    setResult(undefined);
    try {
      const response = await fetch("/api/site-twin-v2/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          moduleReference: "TSM-450NEG9R.28",
          panelCount: 12,
          rows: 2,
          columns: 6,
          orientation: "portrait",
          placement: "centered",
          gutterClearanceMm: 300,
          interPanelGapMm: 20,
          forceSiteTwin,
        }),
      });
      setResult(await response.json() as SiteTwinLayoutResponse);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Reconstruction impossible." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto mt-5 w-[min(1180px,calc(100%-32px))] rounded-3xl border border-cyan-200 bg-white/95 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-cyan-700">
            <ShieldCheck className="size-4" /> Site Twin V2 · validation interne
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Vérifie d&apos;abord la maison et tous ses pans physiques. Aucune DP ne doit reconstruire une autre géométrie ensuite.
          </p>
        </div>
        {result?.siteTwin && (
          <div className="rounded-2xl bg-zinc-950 px-4 py-3 text-xs text-white">
            <div>{result.physicalFaceCount} pans physiques · {result.compatibleFaceCount} compatibles</div>
            <div className="mt-1 text-zinc-300">Confiance {Math.round(result.siteTwin.confidence * 100)} % · rev. {result.siteTwin.revision}</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Adresse exacte du chantier"
          className="min-w-[320px] flex-1 rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-cyan-500"
        />
        <button
          type="button"
          onClick={() => reconstruct(false)}
          disabled={loading || address.trim().length < 8}
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
        >
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Construire le Site Twin
        </button>
        <button
          type="button"
          onClick={() => reconstruct(true)}
          disabled={loading || address.trim().length < 8}
          title="Ignore le cache et reconstruit toute la géométrie"
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 disabled:opacity-40"
        >
          <RefreshCw className="size-4" /> Forcer
        </button>
      </div>

      {result?.error && (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-center gap-2 font-bold"><TriangleAlert className="size-4" /> {result.code ?? "SITE_TWIN_ERROR"}</div>
          <div className="mt-1">{result.error}</div>
        </div>
      )}

      {result?.siteTwin && drawing && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <svg viewBox={drawing.viewBox} className="h-auto w-full">
              {faces.map((face) => {
                const state = eligibility.get(face.id);
                return (
                  <g key={face.id}>
                    <polygon
                      points={drawing.polygon(face.polygonLocalM)}
                      fill={selected.has(face.id) ? "rgba(6,182,212,.22)" : state?.fits ? "rgba(24,24,27,.08)" : "rgba(161,161,170,.12)"}
                      stroke={selected.has(face.id) ? "rgb(8,145,178)" : state?.fits ? "rgb(63,63,70)" : "rgb(161,161,170)"}
                      strokeWidth="2"
                    />
                    <text
                      x={face.polygonLocalM.reduce((sum, point) => sum + (Number(drawing.polygon([point]).split(",")[0]) || 0), 0) / face.polygonLocalM.length}
                      y={face.polygonLocalM.reduce((sum, point) => sum + (Number(drawing.polygon([point]).split(",")[1]) || 0), 0) / face.polygonLocalM.length}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="16"
                      fontWeight="800"
                    >{face.displayLabel}</text>
                  </g>
                );
              })}
              {modules.map((placedModule) => (
                <polygon key={placedModule.moduleIndex} points={drawing.polygon(placedModule.polygonLocalM)} fill="rgba(14,116,144,.70)" stroke="white" strokeWidth="1" />
              ))}
            </svg>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 p-4 text-sm">
              <div className="font-bold text-zinc-950">{result.siteTwin.normalizedAddress}</div>
              <div className="mt-1 text-zinc-500">Parcelle {result.siteTwin.parcelReference}</div>
              <div className="mt-3 break-words text-xs text-zinc-500">Source : {String(result.siteTwin.sources.geometryPrimarySource ?? "inconnue")}</div>
            </div>
            {faces.map((face) => {
              const state = eligibility.get(face.id);
              return (
                <div key={face.id} className="rounded-2xl border border-zinc-200 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <strong>Pan {face.displayLabel}</strong>
                    <span className={state?.fits ? "text-emerald-700" : "text-zinc-400"}>{state?.fits ? "compatible" : "incompatible"}</span>
                  </div>
                  <div className="mt-1 text-zinc-500">{face.areaM2.toFixed(1)} m² · {face.slopeDeg.toFixed(1)}° · azimut {face.azimuthDeg.toFixed(0)}°</div>
                  {state?.resolvedGutterClearanceMm != null && <div className="mt-1 text-zinc-500">Recul bas résolu : {state.resolvedGutterClearanceMm} mm</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

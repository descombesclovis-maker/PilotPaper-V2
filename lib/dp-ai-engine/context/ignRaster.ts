import type { MetricFrame } from "./officialParcel";

export type IgnRasterCandidate = { label: string; url: URL };

export function buildIgnWmsUrl(args: {
  endpoint: string;
  layer: string;
  frame: MetricFrame;
  widthPx: number;
  heightPx: number;
  style?: string;
  format?: "image/jpeg" | "image/png";
  transparent?: boolean;
}) {
  const url = new URL(args.endpoint);
  const params: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: args.layer,
    STYLES: args.style ?? "",
    CRS: "EPSG:3857",
    BBOX: [args.frame.minX, args.frame.minY, args.frame.maxX, args.frame.maxY].join(","),
    WIDTH: String(args.widthPx),
    HEIGHT: String(args.heightPx),
    FORMAT: args.format ?? "image/png",
    TRANSPARENT: args.transparent ? "true" : "false",
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export function orthophotoCandidates(args: {
  frame: MetricFrame;
  widthPx: number;
  heightPx: number;
  format?: "image/jpeg" | "image/png";
}) : IgnRasterCandidate[] {
  const common = { frame: args.frame, widthPx: args.widthPx, heightPx: args.heightPx, format: args.format ?? "image/png" };
  return [
    {
      label: "IGN orthophoto standard",
      url: buildIgnWmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "ORTHOIMAGERY.ORTHOPHOTOS", ...common }),
    },
    {
      label: "IGN orthophoto haute résolution",
      url: buildIgnWmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS", style: "normal", ...common }),
    },
    {
      label: "IGN orthophoto standard secours",
      url: buildIgnWmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "ORTHOIMAGERY.ORTHOPHOTOS", ...common }),
    },
    {
      label: "IGN orthophoto haute résolution secours",
      url: buildIgnWmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "HR.ORTHOIMAGERY.ORTHOPHOTOS", style: "normal", ...common }),
    },
  ];
}

export function cadastralCandidates(args: {
  frame: MetricFrame;
  widthPx: number;
  heightPx: number;
}) : IgnRasterCandidate[] {
  const common = { frame: args.frame, widthPx: args.widthPx, heightPx: args.heightPx, format: "image/png" as const, transparent: true };
  return [
    {
      label: "IGN Parcellaire Express",
      url: buildIgnWmsUrl({ endpoint: "https://data.geopf.fr/wms-r/wms", layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS", style: "normal", ...common }),
    },
    {
      label: "IGN Parcellaire Express secours",
      url: buildIgnWmsUrl({ endpoint: "https://data.geopf.fr/wms-r", layer: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS", style: "normal", ...common }),
    },
  ];
}

export async function fetchIgnRaster(
  candidates: readonly IgnRasterCandidate[],
  options: { purpose: string; minBytes?: number; required?: boolean } = { purpose: "le raster IGN" },
) {
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: { Accept: "image/png,image/jpeg;q=0.9,*/*;q=0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok || !contentType.startsWith("image/")) {
        failures.push(`${candidate.label}:${response.status}:${contentType || "type-inconnu"}`);
        continue;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < (options.minBytes ?? 2_000)) {
        failures.push(`${candidate.label}:image-trop-petite`);
        continue;
      }
      return {
        base64: Buffer.from(bytes).toString("base64"),
        mimeType: contentType.includes("png") ? "image/png" as const : "image/jpeg" as const,
        source: candidate.label,
      };
    } catch (error) {
      failures.push(`${candidate.label}:${error instanceof Error ? error.name : "erreur"}`);
    }
  }
  console.error(`[PilotPaper][IGN] ${options.purpose} failed`, failures);
  if (options.required ?? true) {
    throw new Error(`${options.purpose} officielle indisponible après essai des flux IGN principal et de secours.`);
  }
  return undefined;
}

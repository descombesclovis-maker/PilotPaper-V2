import "server-only";

import { gunzipSync } from "node:zlib";

type JsonObject = Record<string, unknown>;

export type OpenSolarModuleGroupTruth = {
  systemId: number | null;
  systemUuid: string;
  systemName: string;
  moduleQuantity: number | null;
  azimuth: number | null;
  slope: number | null;
  layout: string;
};

export type OpenSolarProjectTruth = {
  projectId: number;
  identifier: string;
  address: string;
  designAvailable: boolean;
  autoFacetsGeoJson: unknown | null;
  autoDesignGeoJson: unknown | null;
  sceneOrigin: unknown | null;
  moduleGroups: OpenSolarModuleGroupTruth[];
  systemCount: number;
  warnings: string[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function decompressOpenSolarDesign(value: unknown): JsonObject | null {
  if (!value) return null;
  if (object(value)) return value as JsonObject;
  if (typeof value !== "string" || value.length < 8) return null;

  try {
    const compressed = Buffer.from(value, "base64");
    const json = gunzipSync(compressed).toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return object(parsed);
  } catch {
    // Some environments/projects may expose the design as plain JSON instead of gzip+base64.
    try {
      const parsed = JSON.parse(value) as unknown;
      return object(parsed);
    } catch {
      return null;
    }
  }
}

function deepFindByKey(root: unknown, wantedKeys: string[], maxDepth = 10): unknown | null {
  const wanted = new Set(wantedKeys.map((key) => key.toLowerCase()));
  const visited = new Set<object>();

  function walk(value: unknown, depth: number): unknown | null {
    if (depth > maxDepth || value === null || typeof value !== "object") return null;
    if (visited.has(value as object)) return null;
    visited.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }

    const record = value as JsonObject;
    for (const [key, child] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && child != null) return child;
    }
    for (const child of Object.values(record)) {
      const found = walk(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  return walk(root, 0);
}

function parseModuleGroups(systemDetails: unknown): OpenSolarModuleGroupTruth[] {
  const details = object(systemDetails);
  const systems = Array.isArray(details?.systems) ? details.systems : [];
  const groups: OpenSolarModuleGroupTruth[] = [];

  for (const rawSystem of systems) {
    const system = object(rawSystem);
    if (!system) continue;
    const rawGroups = Array.isArray(system.module_groups) ? system.module_groups : [];
    for (const rawGroup of rawGroups) {
      const group = object(rawGroup);
      if (!group) continue;
      groups.push({
        systemId: numberOrNull(system.id),
        systemUuid: stringOrEmpty(system.uuid),
        systemName: stringOrEmpty(system.name),
        moduleQuantity: numberOrNull(group.module_quantity),
        azimuth: numberOrNull(group.azimuth),
        slope: numberOrNull(group.slope),
        layout: stringOrEmpty(group.layout),
      });
    }
  }

  return groups;
}

export function extractOpenSolarProjectTruth(args: {
  projectId: number;
  project: JsonObject;
  systemDetails: unknown;
}): OpenSolarProjectTruth {
  const design = decompressOpenSolarDesign(args.project.design);
  const moduleGroups = parseModuleGroups(args.systemDetails);
  const warnings: string[] = [];

  if (!design) warnings.push("Le champ design OpenSolar est absent ou illisible. Le plan Raw Data API est probablement inactif, le projet n'a pas encore de design, ou OpenSolar n'a pas encore fini ses calculs.");
  if (!moduleGroups.length) warnings.push("Aucun module group OpenSolar n'est encore disponible pour ce projet.");

  const autoFacetsGeoJson = design ? deepFindByKey(design, ["autoFacetsGeoJson", "auto_facets_geojson"]) : null;
  const autoDesignGeoJson = design ? deepFindByKey(design, ["autoDesignGeoJson", "auto_design_geojson"]) : null;
  const sceneOrigin = design ? deepFindByKey(design, ["sceneOrigin", "scene_origin", "originLonLat", "origin_lon_lat"]) : null;

  if (design && !autoFacetsGeoJson) warnings.push("Le design est disponible, mais aucun autoFacetsGeoJson n'a été trouvé. Nous ne considérerons pas OpenSolar comme vérité toiture tant que ce champ n'est pas présent et vérifié.");

  const detailsObject = object(args.systemDetails);
  const systems = Array.isArray(detailsObject?.systems) ? detailsObject.systems : [];

  return {
    projectId: args.projectId,
    identifier: stringOrEmpty(args.project.identifier),
    address: stringOrEmpty(args.project.address),
    designAvailable: Boolean(design),
    autoFacetsGeoJson,
    autoDesignGeoJson,
    sceneOrigin,
    moduleGroups,
    systemCount: systems.length,
    warnings,
  };
}

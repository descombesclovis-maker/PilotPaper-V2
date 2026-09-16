import "server-only";

import { createHash } from "node:crypto";
import {
  createOpenSolarProject,
  getOpenSolarProject,
  getOpenSolarRuntimeConfig,
  getOpenSolarSystemDetails,
  listOpenSolarProjects,
} from "@/lib/opensolar/client";
import { extractOpenSolarProjectTruth } from "@/lib/opensolar/design-truth";

type JsonObject = Record<string, unknown>;

export type AdvancedRoofFacet = {
  id: string;
  slopeDeg: number | null;
  azimuthDeg: number | null;
  areaM2: number | null;
  polygonLonLat: Array<[number, number]> | null;
  properties: Record<string, string | number | boolean>;
};

export type AdvancedRoofTruth = {
  available: boolean;
  usable: boolean;
  projectId: number | null;
  roofFacetCount: number;
  facets: AdvancedRoofFacet[];
  autoDesignAvailable: boolean;
  promptContext: string;
  warnings: string[];
};

const cache = new Map<string, Promise<AdvancedRoofTruth>>();

function normalizeAddress(address: string) {
  return address.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

function projectIdentifier(address: string) {
  const digest = createHash("sha256").update(normalizeAddress(address)).digest("hex").slice(0, 20);
  return `pilotpaper-v2-${digest}`;
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finiteOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGeoJson(value: unknown): JsonObject | null {
  if (object(value)) return value as JsonObject;
  if (typeof value !== "string" || value.length < 2) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return object(parsed);
  } catch {
    return null;
  }
}

function propertyNumber(properties: JsonObject, patterns: RegExp[]) {
  for (const [key, value] of Object.entries(properties)) {
    if (!patterns.some((pattern) => pattern.test(key))) continue;
    const parsed = finiteOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function polygonLonLat(feature: JsonObject | null) {
  const geometry = object(feature?.geometry);
  const type = String(geometry?.type ?? "");
  const coordinates = geometry?.coordinates;
  let ring: unknown = null;
  if (type === "Polygon" && Array.isArray(coordinates)) ring = coordinates[0];
  if (type === "MultiPolygon" && Array.isArray(coordinates)) ring = (coordinates[0] as unknown[])?.[0];
  if (!Array.isArray(ring)) return null;
  const points = ring.flatMap((raw) => {
    if (!Array.isArray(raw) || raw.length < 2) return [];
    const longitude = Number(raw[0]);
    const latitude = Number(raw[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return [];
    return [[longitude, latitude] as [number, number]];
  });
  if (points.length < 3) return null;
  const first = points[0];
  const last = points.at(-1);
  if (first && last && first[0] === last[0] && first[1] === last[1]) points.pop();
  return points.length >= 3 ? points : null;
}

function facetSummary(value: unknown) {
  const geo = parseGeoJson(value);
  const features = Array.isArray(geo?.features) ? geo.features : [];
  const summaries: string[] = [];
  const facets: AdvancedRoofFacet[] = [];
  for (let index = 0; index < features.length; index += 1) {
    const feature = object(features[index]);
    const properties = object(feature?.properties) ?? {};
    const picked: Record<string, string | number | boolean> = {};
    for (const [key, child] of Object.entries(properties)) {
      if (/azimuth|pitch|slope|tilt|area|facet|roof|orientation|bearing|id/i.test(key) && ["string", "number", "boolean"].includes(typeof child)) {
        picked[key] = child as string | number | boolean;
      }
    }
    const id = String(
      properties.id
      ?? properties.facet_id
      ?? properties.facetId
      ?? feature?.id
      ?? `facet-${index + 1}`,
    );
    const slopeDeg = propertyNumber(properties, [/^slope$/i, /slope.*deg/i, /^pitch$/i, /pitch.*deg/i, /^tilt$/i]);
    const azimuthDeg = propertyNumber(properties, [/azimuth/i, /bearing/i, /orientation.*deg/i]);
    const areaM2 = propertyNumber(properties, [/^area$/i, /area.*m2/i, /area.*sqm/i, /surface/i]);
    facets.push({
      id,
      slopeDeg,
      azimuthDeg,
      areaM2,
      polygonLonLat: polygonLonLat(feature),
      properties: picked,
    });
    if (Object.keys(picked).length) summaries.push(JSON.stringify(picked));
  }
  return { count: features.length, summaries, facets };
}

function addressParts(address: string) {
  const zipMatch = address.match(/\b(\d{5})\b/);
  const zip = zipMatch?.[1] ?? "";
  const afterZip = zip ? address.slice((zipMatch?.index ?? 0) + zip.length).replace(/^\s*[,;-]?\s*/, "").trim() : "";
  return { zip, locality: afterZip };
}

function allowAutomaticProjectCreation() {
  return /^(1|true|yes)$/i.test(process.env.OPENSOLAR_ALLOW_PROJECT_CREATE?.trim() ?? "");
}

async function ensureProject(address: string) {
  const identifier = projectIdentifier(address);
  const existing = await listOpenSolarProjects(100);
  const match = existing.find((candidate) => String(candidate.identifier ?? "") === identifier);
  const matchedId = integer(match?.id);
  if (matchedId) return matchedId;

  // A remote project created from an address is not proof that roof facets or an
  // automatic design will exist. Project creation can also be billable. PilotPaper
  // therefore reuses existing designed projects by default and only creates one
  // when an administrator has explicitly opted into that behaviour.
  if (!allowAutomaticProjectCreation()) {
    throw new Error("Aucun modèle de toiture distant existant pour cette adresse ; création automatique désactivée.");
  }

  const parts = addressParts(address);
  const created = await createOpenSolarProject({
    identifier,
    address,
    locality: parts.locality,
    zip: parts.zip,
    countryIso2: "FR",
  });
  const createdId = integer(created.id);
  if (!createdId) throw new Error("Le moteur géométrique n'a pas retourné d'identifiant de chantier.");
  return createdId;
}

async function resolveUncached(address: string): Promise<AdvancedRoofTruth> {
  const config = getOpenSolarRuntimeConfig();
  if (!config.enabled || !config.configured) {
    return {
      available: false,
      usable: false,
      projectId: null,
      roofFacetCount: 0,
      facets: [],
      autoDesignAvailable: false,
      promptContext: "",
      warnings: ["Moteur géométrique avancé non disponible : utilisation du fallback PilotPaper."],
    };
  }

  const projectId = await ensureProject(address);
  let truth: ReturnType<typeof extractOpenSolarProjectTruth> | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const project = await getOpenSolarProject(projectId);
    const systemDetails = await getOpenSolarSystemDetails(projectId).catch(() => ({ systems: [] }));
    truth = extractOpenSolarProjectTruth({ projectId, project, systemDetails });
    if (truth.autoFacetsGeoJson) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  if (!truth) throw new Error("Le modèle géométrique du chantier n'a pas pu être lu.");
  const facets = facetSummary(truth.autoFacetsGeoJson);
  const moduleGroups = truth.moduleGroups
    .filter((group) => group.moduleQuantity || group.azimuth !== null || group.slope !== null)
    .slice(0, 8)
    .map((group) => `quantity=${group.moduleQuantity ?? "?"}, azimuth=${group.azimuth ?? "?"}°, slope=${group.slope ?? "?"}°, layout=${group.layout || "?"}`);

  const usable = truth.designAvailable && facets.count > 0;
  const promptContext = usable ? [
    "PILOTPAPER ADVANCED ROOF TRUTH — INDEPENDENT GEOMETRY SOURCE.",
    `A roof model exists for the exact project address. Detected roof facets: ${facets.count}.`,
    ...facets.summaries.map((summary, index) => `Roof facet ${index + 1}: ${summary}`),
    ...(moduleGroups.length ? ["Existing system/model groups:", ...moduleGroups] : []),
    "Use this geometry only to reinforce roof-plane selection, slope/azimuth reasoning and physical plausibility.",
    "The cadastral parcel and real photographs remain authoritative if any external geometry conflicts with visible evidence.",
    "Never change the requested PilotPaper panel count or matrix merely because an external design contains another module quantity.",
  ].join("\n") : "";

  return {
    available: true,
    usable,
    projectId,
    roofFacetCount: facets.count,
    facets: facets.facets,
    autoDesignAvailable: Boolean(truth.autoDesignGeoJson),
    promptContext,
    warnings: truth.warnings,
  };
}

export function resolveAdvancedRoofTruth(address: string) {
  const key = normalizeAddress(address);
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = resolveUncached(address).catch((error) => ({
    available: false,
    usable: false,
    projectId: null,
    roofFacetCount: 0,
    facets: [],
    autoDesignAvailable: false,
    promptContext: "",
    warnings: [error instanceof Error ? error.message : "Moteur géométrique indisponible."],
  } satisfies AdvancedRoofTruth));
  cache.set(key, promise);
  return promise;
}

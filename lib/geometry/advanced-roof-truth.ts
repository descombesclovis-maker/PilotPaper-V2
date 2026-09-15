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

export type AdvancedRoofTruth = {
  available: boolean;
  usable: boolean;
  projectId: number | null;
  roofFacetCount: number;
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

function facetSummary(value: unknown) {
  const geo = parseGeoJson(value);
  const features = Array.isArray(geo?.features) ? geo.features : [];
  const summaries: string[] = [];
  for (const raw of features.slice(0, 12)) {
    const feature = object(raw);
    const properties = object(feature?.properties);
    if (!properties) continue;
    const picked: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(properties)) {
      if (/azimuth|pitch|slope|tilt|area|facet|roof|orientation|bearing|id/i.test(key) && ["string", "number", "boolean"].includes(typeof child)) {
        picked[key] = child;
      }
    }
    if (Object.keys(picked).length) summaries.push(JSON.stringify(picked));
  }
  return { count: features.length, summaries };
}

function addressParts(address: string) {
  const zipMatch = address.match(/\b(\d{5})\b/);
  const zip = zipMatch?.[1] ?? "";
  const afterZip = zip ? address.slice((zipMatch?.index ?? 0) + zip.length).replace(/^\s*[,;-]?\s*/, "").trim() : "";
  return { zip, locality: afterZip };
}

async function ensureProject(address: string) {
  const identifier = projectIdentifier(address);
  const existing = await listOpenSolarProjects(100);
  const match = existing.find((candidate) => String(candidate.identifier ?? "") === identifier);
  const matchedId = integer(match?.id);
  if (matchedId) return matchedId;

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
    autoDesignAvailable: false,
    promptContext: "",
    warnings: [error instanceof Error ? error.message : "Moteur géométrique indisponible."],
  } satisfies AdvancedRoofTruth));
  cache.set(key, promise);
  return promise;
}

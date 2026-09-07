import { getRequestUser } from "@/lib/request-user";

type GeoFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
};

type GeoResponse = { features?: GeoFeature[] };

type ParcelFeature = {
  geometry?: unknown;
  properties?: { contenance?: number; idu?: string; section?: string; numero?: string };
};

type GpuFeature = {
  properties?: Record<string, unknown>;
};

type GpuResponse = { features?: GpuFeature[] };

async function getJson(url: URL) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`IGN ${response.status}`);
  return response.json() as Promise<GeoResponse>;
}

async function getGpu(resource: string, geometry: unknown) {
  const url = new URL(`https://apicarto.ign.fr/api/gpu/${resource}`);
  url.searchParams.set("geom", JSON.stringify(geometry));
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`APICARTO GPU ${resource} ${response.status}`);
  return response.json() as Promise<GpuResponse>;
}

function officialRuleUrl(documentId: string, fileName: string) {
  if (!/^[a-f0-9]{32}$/i.test(documentId) || !/\.pdf$/i.test(fileName)) return "";
  return `https://www.geoportail-urbanisme.gouv.fr/api/document/${documentId}/files/${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request) {
  const user = getRequestUser(request.headers);
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (address.length < 8) return Response.json({ error: "Adresse trop imprécise." }, { status: 400 });

  try {
    const searchUrl = new URL("https://data.geopf.fr/geocodage/search");
    searchUrl.searchParams.set("q", address);
    searchUrl.searchParams.set("index", "address");
    searchUrl.searchParams.set("limit", "1");
    const addressData = await getJson(searchUrl);
    const feature = addressData.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!coordinates) return Response.json({ error: "Adresse non retrouvée par l’IGN." }, { status: 404 });
    const [longitude, latitude] = coordinates;

    const parcelUrl = new URL("https://data.geopf.fr/geocodage/reverse");
    parcelUrl.searchParams.set("lon", String(longitude));
    parcelUrl.searchParams.set("lat", String(latitude));
    parcelUrl.searchParams.set("index", "parcel");
    parcelUrl.searchParams.set("limit", "1");
    const parcelData = await getJson(parcelUrl);
    const parcel = parcelData.features?.[0]?.properties ?? {};
    const properties = feature?.properties ?? {};
    const cityCode = String(properties.citycode ?? "");
    const section = String(parcel.section ?? "");
    const parcelNumber = String(parcel.number ?? "");
    if (!cityCode || !section || !parcelNumber) {
      return Response.json({ error: "La parcelle cadastrale n’a pas pu être déterminée avec certitude." }, { status: 422 });
    }
    const cadastralUrl = new URL("https://apicarto.ign.fr/api/cadastre/parcelle");
    cadastralUrl.searchParams.set("code_insee", cityCode);
    cadastralUrl.searchParams.set("section", section);
    cadastralUrl.searchParams.set("numero", parcelNumber);
    const cadastralResponse = await fetch(cadastralUrl, { headers: { Accept: "application/json" } });
    if (!cadastralResponse.ok) throw new Error(`APICARTO ${cadastralResponse.status}`);
    const cadastralData = await cadastralResponse.json() as { features?: ParcelFeature[] };
    const cadastralFeature = cadastralData.features?.[0];
    const cadastralProperties = cadastralFeature?.properties;
    if (!cadastralProperties?.contenance || !cadastralFeature?.geometry) {
      return Response.json({ error: "La superficie ou la géométrie officielle de la parcelle est absente." }, { status: 422 });
    }

    const point = { type: "Point", coordinates: [longitude, latitude] };
    let urbanism: Record<string, unknown> = {
      status: "unavailable",
      checkedAt: new Date().toISOString(),
      source: "IGN APICARTO — Géoportail de l’urbanisme",
    };
    try {
      const [documents, zones, servitudes, prescriptions, information] = await Promise.all([
        getGpu("document", point),
        getGpu("zone-urba", point),
        getGpu("assiette-sup-s", cadastralFeature.geometry),
        getGpu("prescription-surf", cadastralFeature.geometry),
        getGpu("info-surf", cadastralFeature.geometry),
      ]);
      const productionDocuments = (documents.features ?? []).filter((item) => String(item.properties?.gpu_status ?? "") === "production");
      const productionZones = (zones.features ?? []).filter((item) => String(item.properties?.gpu_status ?? "") === "production");
      const zoneNames = [...new Set(productionZones.map((item) => String(item.properties?.libelle ?? "").trim()).filter(Boolean))];
      const document = productionDocuments[0]?.properties ?? {};
      const zone = productionZones[0]?.properties ?? {};
      const documentId = String(zone.gpu_doc_id ?? document.gpu_doc_id ?? document.id ?? "");
      const ruleFile = String(zone.nomfic ?? "");
      const supCategories = [...new Set((servitudes.features ?? [])
        .map((item) => String(item.properties?.suptype ?? "").toUpperCase())
        .filter(Boolean))].sort();
      const protectedCategories = supCategories.filter((item) => ["AC1", "AC2", "AC4"].includes(item));
      const ambiguous = productionDocuments.length !== 1 || zoneNames.length !== 1;
      urbanism = {
        status: ambiguous || !documentId || !ruleFile ? "ambiguous" : "verified-source",
        documentId,
        documentType: String(document.du_type ?? ""),
        documentName: String(document.name ?? zone.idurba ?? ""),
        documentTimestamp: String(zone.gpu_timestamp ?? document.gpu_timestamp ?? ""),
        zone: zoneNames[0] ?? "",
        zoneLabel: String(zone.libelong ?? ""),
        ruleFile,
        ruleSourceUrl: officialRuleUrl(documentId, ruleFile),
        supCategories,
        protectedArea: protectedCategories.length > 0,
        protectedCategories,
        authorityReviewRequired: protectedCategories.length > 0,
        prescriptionCount: prescriptions.features?.length ?? 0,
        informationCount: information.features?.length ?? 0,
        checkedAt: new Date().toISOString(),
        source: "IGN APICARTO — Géoportail de l’urbanisme",
      };
    } catch (gpuError) {
      console.error("[site-context] GPU lookup failed", gpuError);
    }

    return Response.json({
      context: {
        normalizedAddress: String(properties.label ?? properties.name ?? address),
        longitude,
        latitude,
        cityCode,
        postcode: String(properties.postcode ?? ""),
        municipality: String(properties.city ?? ""),
        parcelId: String(cadastralProperties.idu ?? parcel.id ?? parcel.name ?? parcel.label ?? ""),
        parcelAreaM2: cadastralProperties.contenance,
        parcelGeometry: cadastralFeature.geometry,
        source: "IGN Géoplateforme — BAN, Parcellaire Express PCI et APICARTO Cadastre",
        checkedAt: new Date().toISOString(),
        urbanism,
      },
    });
  } catch (error) {
    console.error("[site-context] IGN lookup failed", error);
    return Response.json({ error: "Les données IGN officielles sont indisponibles. Le dossier reste bloqué." }, { status: 503 });
  }
}

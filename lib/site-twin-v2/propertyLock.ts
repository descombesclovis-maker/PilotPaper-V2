import { parcelRings } from "@/lib/dp-ai-engine/context/officialParcel";
import { resolveAddressPropertyContext } from "@/lib/dp-ai-engine/site-model/addressPropertyResolver";
import type { SiteTwinBuilding, SiteTwinEvidence, SiteTwinParcel, TwinLonLat } from "./types";

export type SiteTwinPropertyLock = {
  normalizedAddress: string;
  addressPoint: TwinLonLat;
  parcel: SiteTwinParcel;
  buildings: SiteTwinBuilding[];
  targetBuildingIds: string[];
  evidence: SiteTwinEvidence[];
};

/**
 * Stage 1 of Site Twin V2. No roof provider is allowed to run before this lock
 * exists. Google Solar therefore cannot choose or move the cadastral property.
 */
export async function lockSiteTwinProperty(address: string): Promise<SiteTwinPropertyLock> {
  const resolved = await resolveAddressPropertyContext(address);
  const parcelRing = parcelRings(resolved.parcel.parcelGeometry)[0];
  if (!parcelRing || parcelRing.length < 3) {
    throw new Error("Site Twin : la parcelle cadastrale verrouillée ne fournit pas un polygone exploitable.");
  }

  const buildings: SiteTwinBuilding[] = resolved.buildings.map((building) => ({
    id: building.id,
    polygonLonLat: building.polygon,
    heightM: building.heightM,
    evidence: [{
      source: "bdtopo",
      confidence: building.id === resolved.building.id ? 0.98 : 0.90,
      reference: building.id,
      notes: building.id === resolved.building.id
        ? ["Volume BD TOPO principal choisi depuis le point d'adresse avant toute analyse de toiture."]
        : ["Volume directement contigu au bâtiment adressé et contenu dans la parcelle verrouillée."],
    }],
  }));

  const targetBuildingIds = buildings.map((building) => building.id);
  if (!targetBuildingIds.length) throw new Error("Site Twin : aucun bâtiment cible après verrouillage cadastral.");

  return {
    normalizedAddress: resolved.parcel.normalizedAddress,
    addressPoint: [resolved.parcel.longitude, resolved.parcel.latitude],
    parcel: {
      reference: resolved.parcel.parcelReference,
      polygonLonLat: parcelRing,
      areaM2: resolved.parcel.parcelAreaM2,
    },
    buildings,
    targetBuildingIds,
    evidence: [
      {
        source: "address",
        confidence: 0.99,
        reference: resolved.parcel.normalizedAddress,
        notes: ["Le numéro d'adresse est l'ancre initiale de la propriété."],
      },
      {
        source: "cadastre",
        confidence: 0.99,
        reference: resolved.parcel.parcelReference,
        notes: ["Cette parcelle reste verrouillée pour toute la génération du dossier."],
      },
    ],
  };
}

import { normalizeSiret, validateSiret } from "@/lib/siret";

type Establishment = {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  activite_principale?: string;
  etat_administratif?: string;
};

type CompanyResult = {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  sigle?: string;
  nature_juridique?: string;
  activite_principale?: string;
  etat_administratif?: string;
  date_creation?: string;
  siege?: Establishment;
  matching_etablissements?: Establishment[];
};

function exactEstablishment(result: CompanyResult, siret: string) {
  const matches = result.matching_etablissements ?? [];
  return (
    matches.find((establishment) => establishment.siret === siret) ??
    (result.siege?.siret === siret ? result.siege : undefined)
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ siret: string }> },
) {
  const { siret: rawSiret } = await context.params;
  const siret = normalizeSiret(rawSiret);

  if (!validateSiret(siret)) {
    return Response.json(
      { error: "Le numéro SIRET est invalide.", code: "INVALID_SIRET" },
      { status: 400 },
    );
  }

  const endpoint = new URL("https://recherche-entreprises.api.gouv.fr/search");
  endpoint.searchParams.set("q", siret);
  endpoint.searchParams.set("per_page", "10");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return Response.json(
        {
          error: "La source officielle est momentanément indisponible.",
          code: "SOURCE_UNAVAILABLE",
        },
        { status: 503 },
      );
    }

    const payload = (await response.json()) as { results?: CompanyResult[] };
    const match = (payload.results ?? [])
      .map((result) => ({
        result,
        establishment: exactEstablishment(result, siret),
      }))
      .find(({ establishment }) => Boolean(establishment));

    if (!match?.establishment) {
      return Response.json(
        {
          error:
            "Aucun établissement public ne correspond exactement à ce SIRET. Une vérification manuelle sera nécessaire.",
          code: "NOT_FOUND",
          manualReviewRequired: true,
        },
        { status: 404 },
      );
    }

    const { result, establishment } = match;
    const active =
      establishment.etat_administratif === "A" &&
      (!result.etat_administratif || result.etat_administratif === "A");
    const address =
      establishment.adresse ??
      [establishment.code_postal, establishment.libelle_commune]
        .filter(Boolean)
        .join(" ");

    return Response.json(
      {
        company: {
          siret,
          siren: result.siren ?? siret.slice(0, 9),
          name:
            result.nom_complet ??
            result.nom_raison_sociale ??
            result.sigle ??
            "Dénomination non diffusée",
          address,
          ape:
            establishment.activite_principale ??
            result.activite_principale ??
            null,
          legalFormCode: result.nature_juridique ?? null,
          createdAt: result.date_creation ?? null,
          active,
          source: "API Recherche d’entreprises — DINUM / données Sirene INSEE",
          checkedAt: new Date().toISOString(),
        },
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return Response.json(
      {
        error: timedOut
          ? "La vérification officielle a dépassé le délai autorisé. Réessayez."
          : "La vérification SIRET n’a pas pu aboutir.",
        code: timedOut ? "SOURCE_TIMEOUT" : "LOOKUP_FAILED",
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

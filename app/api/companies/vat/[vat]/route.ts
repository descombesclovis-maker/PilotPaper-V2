import {
  normalizeFrenchVat,
  sirenFromFrenchVat,
  validateFrenchVat,
} from "@/lib/vat";

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
  activite_principale?: string;
  etat_administratif?: string;
  nature_juridique?: string;
  siege?: Establishment;
  matching_etablissements?: Establishment[];
};

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return match?.[1]
    ?.replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function establishmentAddress(establishment?: Establishment) {
  if (!establishment) return "";
  return (
    establishment.adresse ??
    [establishment.code_postal, establishment.libelle_commune]
      .filter(Boolean)
      .join(" ")
  );
}

async function verifyWithVies(vat: string, signal: AbortSignal) {
  const vatNumber = vat.slice(2);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <soap:Header/>
      <soap:Body>
        <urn:checkVat>
          <urn:countryCode>FR</urn:countryCode>
          <urn:vatNumber>${vatNumber}</urn:vatNumber>
        </urn:checkVat>
      </soap:Body>
    </soap:Envelope>`;

  const response = await fetch(
    "https://ec.europa.eu/taxation_customs/vies/services/checkVatService",
    {
      method: "POST",
      headers: {
        Accept: "text/xml",
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      body,
      signal,
    },
  );

  if (!response.ok) {
    throw new Error("VIES_UNAVAILABLE");
  }

  const xml = await response.text();
  if (/<(?:\w+:)?Fault[\s>]/i.test(xml)) {
    throw new Error("VIES_UNAVAILABLE");
  }

  return {
    valid: xmlValue(xml, "valid") === "true",
    name: xmlValue(xml, "name") ?? "",
    address: xmlValue(xml, "address") ?? "",
  };
}

async function findOfficialCompany(siren: string, signal: AbortSignal) {
  const endpoint = new URL("https://recherche-entreprises.api.gouv.fr/search");
  endpoint.searchParams.set("q", siren);
  endpoint.searchParams.set("per_page", "10");
  endpoint.searchParams.set("limite_matching_etablissements", "50");

  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("SIRENE_UNAVAILABLE");

  const payload = (await response.json()) as { results?: CompanyResult[] };
  return (payload.results ?? []).find((result) => result.siren === siren);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ vat: string }> },
) {
  const { vat: rawVat } = await context.params;
  const vat = normalizeFrenchVat(rawVat);

  if (!validateFrenchVat(vat)) {
    return Response.json(
      {
        error: "Le numéro de TVA français doit contenir FR, une clé de 2 caractères et un SIREN de 9 chiffres.",
        code: "INVALID_VAT_FORMAT",
        manualReviewRequired: true,
      },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const vies = await verifyWithVies(vat, controller.signal);
    if (!vies.valid) {
      return Response.json(
        {
          error: "Ce numéro de TVA n’est pas déclaré valide par VIES.",
          code: "VAT_NOT_VALID",
          manualReviewRequired: true,
        },
        { status: 422 },
      );
    }

    const siren = sirenFromFrenchVat(vat);
    const official = await findOfficialCompany(siren, controller.signal);
    if (!official) {
      return Response.json(
        {
          error: "La TVA est valide, mais aucun SIREN identique n’a pu être rapproché dans la source française.",
          code: "SIREN_NOT_FOUND",
          manualReviewRequired: true,
        },
        { status: 404 },
      );
    }

    const headOffice = official.siege;
    const establishments = [
      ...(headOffice?.siret ? [{ ...headOffice, isHeadOffice: true }] : []),
      ...(official.matching_etablissements ?? [])
        .filter((item) => item.siret && item.siret !== headOffice?.siret)
        .map((item) => ({ ...item, isHeadOffice: false })),
    ].map((item) => ({
      siret: item.siret ?? "",
      address: establishmentAddress(item),
      ape: item.activite_principale ?? official.activite_principale ?? null,
      active: item.etat_administratif === "A",
      isHeadOffice: item.isHeadOffice,
    }));

    const selected = establishments.find((item) => item.isHeadOffice) ?? establishments[0];
    const active =
      official.etat_administratif === "A" && Boolean(selected?.active ?? true);

    return Response.json(
      {
        company: {
          vat,
          siren,
          siret: selected?.siret ?? "",
          name:
            official.nom_complet ??
            official.nom_raison_sociale ??
            official.sigle ??
            vies.name ??
            "Dénomination non diffusée",
          address: selected?.address || vies.address,
          ape: selected?.ape ?? official.activite_principale ?? null,
          legalFormCode: official.nature_juridique ?? null,
          createdAt: null,
          active,
          establishments,
          source:
            "VIES — Commission européenne + API Recherche d’entreprises — DINUM / données Sirene INSEE",
          checkedAt: new Date().toISOString(),
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return Response.json(
      {
        error: timedOut
          ? "Les sources officielles n’ont pas répondu dans le délai autorisé. Réessayez."
          : "La double vérification TVA/Sirene est momentanément impossible.",
        code: timedOut ? "SOURCE_TIMEOUT" : "SOURCE_UNAVAILABLE",
        manualReviewRequired: true,
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

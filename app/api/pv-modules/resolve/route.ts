import { getRequestUser } from "@/lib/request-user";
import {
  listVerifiedPvModules,
  PV_MODULE_CATALOG_VERSION,
  resolveVerifiedPvModule,
} from "@/lib/pv-module-catalog";

function publicModule(moduleSpec: ReturnType<typeof listVerifiedPvModules>[number]) {
  return {
    manufacturer: moduleSpec.manufacturer,
    model: moduleSpec.model,
    canonicalReference: moduleSpec.canonicalReference,
    widthMm: moduleSpec.widthMm,
    heightMm: moduleSpec.heightMm,
    thicknessMm: moduleSpec.thicknessMm,
    powerWp: moduleSpec.powerWp,
    sourceUrl: moduleSpec.sourceUrl,
    sourceDocument: moduleSpec.sourceDocument,
    sourceUpdatedAt: moduleSpec.sourceUpdatedAt,
    verifiedAt: moduleSpec.verifiedAt,
  };
}

export async function GET(request: Request) {
  const user = getRequestUser(request.headers);
  if (!user) return Response.json({ error: "Authentification requise." }, { status: 401 });

  const url = new URL(request.url);
  const reference = url.searchParams.get("reference")?.trim() ?? "";

  if (!reference) {
    return Response.json({
      catalogVersion: PV_MODULE_CATALOG_VERSION,
      modules: listVerifiedPvModules().map(publicModule),
    });
  }

  const moduleSpec = resolveVerifiedPvModule(reference);
  if (!moduleSpec) {
    return Response.json({
      code: "MODULE_REFERENCE_UNKNOWN",
      catalogVersion: PV_MODULE_CATALOG_VERSION,
      error: `La référence « ${reference} » n'existe pas dans le catalogue fabricant vérifié. Ajoutez sa fiche technique fabricant avant de poursuivre.`,
    }, { status: 404 });
  }

  return Response.json({
    catalogVersion: PV_MODULE_CATALOG_VERSION,
    module: publicModule(moduleSpec),
  });
}

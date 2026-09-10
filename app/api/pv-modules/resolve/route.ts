import { getRequestUser } from "@/lib/request-user";
import {
  listVerifiedPvModules,
  PV_MODULE_CATALOG_VERSION,
  resolveVerifiedPvModule,
} from "@/lib/pv-module-catalog";

function publicModule(module: ReturnType<typeof listVerifiedPvModules>[number]) {
  return {
    manufacturer: module.manufacturer,
    model: module.model,
    canonicalReference: module.canonicalReference,
    widthMm: module.widthMm,
    heightMm: module.heightMm,
    thicknessMm: module.thicknessMm,
    powerWp: module.powerWp,
    sourceUrl: module.sourceUrl,
    sourceDocument: module.sourceDocument,
    sourceUpdatedAt: module.sourceUpdatedAt,
    verifiedAt: module.verifiedAt,
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

  const module = resolveVerifiedPvModule(reference);
  if (!module) {
    return Response.json({
      code: "MODULE_REFERENCE_UNKNOWN",
      catalogVersion: PV_MODULE_CATALOG_VERSION,
      error: `La référence « ${reference} » n'existe pas dans le catalogue fabricant vérifié. Ajoutez sa fiche technique fabricant avant de poursuivre.`,
    }, { status: 404 });
  }

  return Response.json({
    catalogVersion: PV_MODULE_CATALOG_VERSION,
    module: publicModule(module),
  });
}

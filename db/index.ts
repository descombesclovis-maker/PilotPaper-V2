import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. PilotPaper v0.4.3 doit etre lance via Vite avec le plugin Cloudflare local."
    );
  }

  return drizzle(env.DB, { schema });
}

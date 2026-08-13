import type { PrismaClient } from "@/server/db/generated/client";

/**
 * Every identity the deterministic participant matcher (resolveParticipantRoles)
 * is allowed to recognize as "this is the business" — individual advisor
 * names (User.name) PLUS the business's own registered account name
 * (Business.name).
 *
 * Confirmed against a real production export: a WhatsApp Business export's
 * sender label for outbound messages is ALWAYS the business's own account
 * display name ("Koriaki Import"), never an individual advisor's name — so
 * matching against User.name alone never resolves deterministically for any
 * real Koriaki export, forcing every single import into manual resolution.
 * Business.name ("Koriaki") shares a whole word with "Koriaki Import", so
 * the EXISTING word-overlap rule in resolveParticipantRoles already matches
 * it correctly once it's included here — no change to that matching logic
 * itself, only to what identity data it's given.
 *
 * Shared between server/application/whatsapp-actions.ts (the CRM historical
 * importer) and server/application/knowledge-actions.ts (the Knowledge
 * Ingestion conversation importer) — two separate import pipelines that both
 * feed the same deterministic parser and had the same bug independently.
 */
export async function fetchKnownBusinessNames(businessId: string, db: PrismaClient): Promise<string[]> {
  const [businessUsers, business] = await Promise.all([
    db.user.findMany({ where: { businessId }, select: { name: true } }),
    db.business.findUnique({ where: { id: businessId }, select: { name: true } }),
  ]);
  const names = businessUsers.map((u) => u.name);
  if (business?.name) names.push(business.name);
  return names;
}

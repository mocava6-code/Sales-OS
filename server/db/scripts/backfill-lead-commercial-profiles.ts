import "dotenv/config";
import { fileURLToPath } from "node:url";
import { prisma } from "../client";
import type { PrismaClient } from "../generated/client";
import { computeLeadCommercialProfileUpdate, projectLeadCommercialProfile } from "../../services/lead-commercial-profile-service";

// Populates LeadCommercialProfile for a business's existing leads. Safe to
// run repeatedly (idempotent — computeLeadCommercialProfileUpdate/
// projectLeadCommercialProfile are the same functions the live webhook
// pipeline uses). Never imports anything under server/whatsapp/**, never
// touches PendingWhatsAppMessage/sender.ts/queue.ts, never calls a Decision
// approval/execute workflow, never constructs or POSTs a webhook payload —
// this is a pure read+project over existing Lead/Conversation/
// ConversationSnapshot data.
//
// Usage:
//   npx tsx server/db/scripts/backfill-lead-commercial-profiles.ts \
//     --business=Koriaki [--dryRun] [--batchSize=50]

export interface BackfillOptions {
  businessId: string;
  dryRun: boolean;
  batchSize: number;
}

export interface BackfillResult {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  /** Sanitized: error.message only, never a raw stack. */
  failures: Array<{ leadId: string; message: string }>;
}

/**
 * Cursor-based pagination (not skip: n*batchSize) — correct even though
 * leads are written to as this reads, unlike offset pagination.
 */
export async function runBackfill(options: BackfillOptions, db: PrismaClient = prisma): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, created: 0, updated: 0, skipped: 0, failures: [] };
  let cursor: string | undefined;

  while (true) {
    const leads = await db.lead.findMany({
      where: { businessId: options.businessId },
      orderBy: { id: "asc" },
      take: options.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true },
    });
    if (leads.length === 0) break;

    for (const lead of leads) {
      result.scanned++;
      try {
        if (options.dryRun) {
          const update = await computeLeadCommercialProfileUpdate(options.businessId, lead.id, db);
          if (update.hasChanges) {
            if (update.rowExisted) result.updated++;
            else result.created++;
          } else {
            result.skipped++;
          }
        } else {
          const projection = await projectLeadCommercialProfile(options.businessId, lead.id, db);
          if (projection.created) result.created++;
          else if (projection.updated) result.updated++;
          else result.skipped++;
        }
      } catch (error) {
        result.failures.push({ leadId: lead.id, message: error instanceof Error ? error.message : String(error) });
      }
    }

    cursor = leads[leads.length - 1].id;
  }

  return result;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv) {
    const withValue = /^--([^=]+)=(.*)$/.exec(raw);
    if (withValue) {
      args[withValue[1]] = withValue[2];
      continue;
    }
    const flag = /^--(.+)$/.exec(raw);
    if (flag) args[flag[1]] = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const businessName = args.business;
  if (typeof businessName !== "string" || businessName.length === 0) {
    throw new Error("Missing required argument: --business=<name>");
  }
  const dryRun = args.dryRun === true;
  const batchSize = typeof args.batchSize === "string" ? Number.parseInt(args.batchSize, 10) : 50;
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid --batchSize: ${String(args.batchSize)}`);
  }

  const business = await prisma.business.findUnique({ where: { name: businessName } });
  if (!business) {
    throw new Error(`No business named "${businessName}" found. Nothing was read or written.`);
  }

  console.log(`Backfilling LeadCommercialProfile for "${business.name}" (${business.id})${dryRun ? " [DRY RUN]" : ""}, batchSize=${batchSize}`);

  const result = await runBackfill({ businessId: business.id, dryRun, batchSize });

  console.log(
    `Scanned=${result.scanned} Created=${result.created} Updated=${result.updated} Skipped=${result.skipped} Failures=${result.failures.length}`,
  );
  if (result.failures.length > 0) {
    console.log("Failures:");
    for (const failure of result.failures.slice(0, 20)) {
      console.log(`  leadId=${failure.leadId}: ${failure.message}`);
    }
    if (result.failures.length > 20) {
      console.log(`  ...and ${result.failures.length - 20} more`);
    }
  }
}

// Guards against running main() (which requires --business and touches
// the database) as a side effect of another module simply importing
// runBackfill — e.g. this file's own test suite, which imports runBackfill
// directly and must never trigger the CLI entrypoint.
const isDirectlyExecuted = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectlyExecuted) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

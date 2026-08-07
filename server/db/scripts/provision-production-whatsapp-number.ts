import "dotenv/config";
import { prisma } from "../client";
import { Prisma } from "../generated/client";

// TEMPORARY bootstrap for the pilot: server/whatsapp/phone-numbers.ts
// (registerWhatsAppPhoneNumber, wired into the /settings/whatsapp UI) is
// the real, permanent provisioning flow — this script is today's one-off
// way to reach the same table before there's someone logged in as OWNER
// to use that UI against production. Safe to delete once that UI has been
// used once against production, or once this number is confirmed registered.
//
// Doesn't import registerWhatsAppPhoneNumber directly: every file under
// server/whatsapp/ starts with `import "server-only"`, which throws outside
// Next.js's bundler (and outside vitest, which aliases it to a no-op — see
// vitest.config.ts). A plain `tsx` invocation has neither, so this script
// talks to Prisma directly instead, duplicating just the create-and-catch-
// P2002 logic that function uses.
//
// Every value is required on the command line — nothing here is guessed
// or defaulted, per the forensic audit that preceded this: phoneNumberId,
// displayPhoneNumber, and wabaId must all be copied verbatim from Meta's
// WhatsApp Manager for the number actually delivering webhooks.
//
// Usage:
//   npx tsx server/db/scripts/provision-production-whatsapp-number.ts \
//     --phoneNumberId=843458045523703 \
//     --displayPhoneNumber="+51 999 999 999" \
//     --wabaId=<the WABA id shown for that number in Meta> \
//     --business=Koriaki \
//     --label="Production line"   (optional)
//
// Runs against whatever DATABASE_URL is loaded from .env — confirm that's
// actually production before running. Idempotent: re-running with the same
// --phoneNumberId is a safe no-op (reports "already registered" instead of
// erroring), same guarantee as the UI form.

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (!match) continue;
    args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const businessName = args.business ?? "Koriaki";

  const missing = ["phoneNumberId", "displayPhoneNumber", "wabaId"].filter((key) => !args[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required argument(s): ${missing.join(", ")}. ` +
        `Copy these values exactly from Meta's WhatsApp Manager — see this file's header comment for usage.`,
    );
  }

  const business = await prisma.business.findUnique({ where: { name: businessName } });
  if (!business) {
    throw new Error(`No business named "${businessName}" found. Nothing was written.`);
  }

  try {
    const record = await prisma.whatsAppPhoneNumber.create({
      data: {
        businessId: business.id,
        phoneNumberId: args.phoneNumberId,
        displayPhoneNumber: args.displayPhoneNumber,
        wabaId: args.wabaId,
        label: args.label,
      },
    });

    console.log(
      `Registered WhatsApp number for "${business.name}" (${business.id}): ` +
        `id=${record.id} phoneNumberId=${record.phoneNumberId} displayPhoneNumber=${record.displayPhoneNumber} ` +
        `wabaId=${record.wabaId} label=${record.label ?? "(none)"}`,
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.log(`Already registered — nothing to do: phone_number_id "${args.phoneNumberId}" already has a row.`);
      return;
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

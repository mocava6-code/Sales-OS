import "server-only";

import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { WhatsAppPhoneNumber } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { DuplicatePhoneNumberError } from "./errors";

// Provisions the row server/whatsapp/gateway.ts's findPhoneNumberByPhoneNumberId
// depends on for every inbound message. Before this file existed, nothing in
// the codebase ever wrote to WhatsAppPhoneNumber outside of tests — see
// server/whatsapp/__tests__/test-db.ts's fixture — which is why inbound
// webhooks failed with UnknownPhoneNumberError even though the webhook
// itself, the gateway, and the Lead/Conversation pipeline downstream of it
// were all working correctly. This module is the missing onboarding step,
// not a change to the ingestion pipeline itself.

export interface RegisterWhatsAppPhoneNumberInput {
  phoneNumberId: string;
  displayPhoneNumber: string;
  wabaId: string;
  label?: string;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Race-safe the same way server/whatsapp/gateway.ts's appendEntry is:
 * attempts the insert and lets the unique index on phoneNumberId be the
 * real backstop, rather than a look-before-write check that two concurrent
 * registrations could both pass. Access control (OWNER-only) is the
 * caller's job (server/application/whatsapp-actions.ts) — this function
 * trusts businessId the same as every other Prisma*Service in this codebase.
 */
export async function registerWhatsAppPhoneNumber(
  businessId: string,
  input: RegisterWhatsAppPhoneNumberInput,
  db: PrismaClientOrTransaction = prisma,
): Promise<WhatsAppPhoneNumber> {
  try {
    return await db.whatsAppPhoneNumber.create({
      data: {
        businessId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber,
        wabaId: input.wabaId,
        label: input.label,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new DuplicatePhoneNumberError(input.phoneNumberId);
    }
    throw error;
  }
}

export async function listWhatsAppPhoneNumbers(
  businessId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<WhatsAppPhoneNumber[]> {
  return db.whatsAppPhoneNumber.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
}

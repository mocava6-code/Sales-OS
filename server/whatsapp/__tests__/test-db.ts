// Shared fixtures for WhatsApp integration DB tests — extends
// server/persistence/__tests__/test-db.ts's Business/User/Lead/Conversation
// fixture with a WhatsAppPhoneNumber, and cleans up every WhatsApp-specific
// table before delegating to the base cleanup. Same RUN_DB_TESTS gate,
// same isolated sales_os_test instance — see that file for the full
// rationale.

import type { PrismaClient } from "../../db/generated/client";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../persistence/__tests__/test-db";

export { getTestPrisma, shouldRunDbTests };

export interface WhatsAppTestFixture extends TestFixture {
  whatsappPhoneNumberId: string;
  phoneNumberId: string;
}

export async function createWhatsAppTestFixture(db: PrismaClient, label: string): Promise<WhatsAppTestFixture> {
  const base = await createTestFixture(db, label);
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const phoneNumberId = `test-phone-number-id-${suffix}`;

  const whatsappPhoneNumber = await db.whatsAppPhoneNumber.create({
    data: {
      businessId: base.businessId,
      phoneNumberId,
      displayPhoneNumber: "+10000000001",
      wabaId: `test-waba-${suffix}`,
    },
  });

  return { ...base, whatsappPhoneNumberId: whatsappPhoneNumber.id, phoneNumberId };
}

export async function cleanupWhatsAppTestFixture(db: PrismaClient, fixture: WhatsAppTestFixture): Promise<void> {
  const pendingMessages = await db.pendingWhatsAppMessage.findMany({
    where: { conversationId: fixture.conversationId },
    select: { id: true },
  });
  const pendingMessageIds = pendingMessages.map((m) => m.id);

  if (pendingMessageIds.length > 0) {
    await db.whatsAppMessageStatusEvent.deleteMany({ where: { pendingMessageId: { in: pendingMessageIds } } });
  }
  await db.pendingWhatsAppMessage.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.conversationEntry.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.whatsAppPhoneNumber.deleteMany({ where: { id: fixture.whatsappPhoneNumberId } });

  await cleanupTestFixture(db, fixture);
}

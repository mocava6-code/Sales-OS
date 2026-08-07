// Gated: proves registerWhatsAppPhoneNumber/listWhatsAppPhoneNumbers against
// real Postgres (sales_os_test) — in particular that the unique index on
// phoneNumberId, not a look-before-write check, is what rejects a duplicate.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuplicatePhoneNumberError } from "../errors";
import { listWhatsAppPhoneNumbers, registerWhatsAppPhoneNumber } from "../phone-numbers";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("registerWhatsAppPhoneNumber (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "phone-numbers");
  });

  afterEach(async () => {
    await db!.whatsAppPhoneNumber.deleteMany({ where: { businessId: fixture.businessId } });
    await cleanupTestFixture(db!, fixture);
  });

  it("creates a row scoped to the business", async () => {
    const record = await registerWhatsAppPhoneNumber(
      fixture.businessId,
      { phoneNumberId: "843458045523703", displayPhoneNumber: "+51 999 999 999", wabaId: "860448446409411", label: "Main line" },
      db,
    );

    expect(record.businessId).toBe(fixture.businessId);
    expect(record.phoneNumberId).toBe("843458045523703");
    expect(record.label).toBe("Main line");

    const listed = await listWhatsAppPhoneNumbers(fixture.businessId, db);
    expect(listed.map((r) => r.id)).toContain(record.id);
  });

  it("creates a row with no label when none is given", async () => {
    const record = await registerWhatsAppPhoneNumber(
      fixture.businessId,
      { phoneNumberId: "111111111111111", displayPhoneNumber: "+51 111 111 111", wabaId: "222222222222222" },
      db,
    );

    expect(record.label).toBeNull();
  });

  it("rejects a second registration of the same phoneNumberId, even for a different business", async () => {
    await registerWhatsAppPhoneNumber(
      fixture.businessId,
      { phoneNumberId: "333333333333333", displayPhoneNumber: "+51 333 333 333", wabaId: "444444444444444" },
      db,
    );

    const otherFixture = await createTestFixture(db!, "phone-numbers-other");
    try {
      await expect(
        registerWhatsAppPhoneNumber(
          otherFixture.businessId,
          { phoneNumberId: "333333333333333", displayPhoneNumber: "+51 000 000 000", wabaId: "555555555555555" },
          db,
        ),
      ).rejects.toBeInstanceOf(DuplicatePhoneNumberError);
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });

  it("lists only the calling business's numbers", async () => {
    await registerWhatsAppPhoneNumber(
      fixture.businessId,
      { phoneNumberId: "666666666666666", displayPhoneNumber: "+51 666 666 666", wabaId: "777777777777777" },
      db,
    );

    const otherFixture = await createTestFixture(db!, "phone-numbers-list-other");
    try {
      await registerWhatsAppPhoneNumber(
        otherFixture.businessId,
        { phoneNumberId: "888888888888888", displayPhoneNumber: "+51 888 888 888", wabaId: "999999999999999" },
        db,
      );

      const listed = await listWhatsAppPhoneNumbers(fixture.businessId, db);
      expect(listed.every((r) => r.businessId === fixture.businessId)).toBe(true);
      expect(listed.map((r) => r.phoneNumberId)).not.toContain("888888888888888");
    } finally {
      await db!.whatsAppPhoneNumber.deleteMany({ where: { businessId: otherFixture.businessId } });
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});

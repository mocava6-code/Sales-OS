// Kori Sales Memory v1 — the lightweight outcome-recording path. Deliberately
// NOT going through server/orchestration/outcome-workflows.ts: that path
// requires a DecisionRecord and runs assertOutcomeRecordable (a policy about
// whether an outcome's attribution is consistent with a decision's status),
// neither of which applies here — there is no decision, so attribution is
// always UNATTRIBUTED and there is no status to be consistent with. Writes
// straight to the Outcome table, same as lead-service.ts/follow-up-service.ts
// write straight to their own tables — no unit-of-work, no transaction
// machinery, because there's nothing here that needs one.

import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/generated/client";
import type { RecordConversationOutcomeInput } from "@/lib/validations/outcome";

export interface ConversationOutcome {
  id: string;
  conversationId: string;
  outcomeType: string;
  lostReason: string | null;
  productSold: string | null;
  notes: string | null;
  occurredAt: Date;
}

export async function recordConversationOutcome(
  businessId: string,
  conversationId: string,
  recordedByUserId: string,
  input: Pick<RecordConversationOutcomeInput, "outcomeType" | "lostReason" | "productSold" | "notes">,
  db: PrismaClient = prisma,
): Promise<ConversationOutcome> {
  const outcome = await db.outcome.create({
    data: {
      businessId,
      conversationId,
      recordedByUserId,
      outcomeType: input.outcomeType,
      attribution: "UNATTRIBUTED",
      lostReason: input.lostReason,
      productSold: input.productSold,
      notes: input.notes,
    },
  });

  return {
    id: outcome.id,
    conversationId: outcome.conversationId,
    outcomeType: outcome.outcomeType,
    lostReason: outcome.lostReason,
    productSold: outcome.productSold,
    notes: outcome.notes,
    occurredAt: outcome.occurredAt,
  };
}

import { prisma } from "@/server/db/client";
import type { FollowUpInput } from "@/lib/validations/follow-up";
import { assertLeadBelongsToBusiness } from "./lead-service";

export async function listOverdueFollowUps(businessId: string) {
  return prisma.followUp.findMany({
    where: {
      status: "PENDING",
      dueAt: { lt: new Date() },
      lead: { businessId },
    },
    include: { lead: true },
    orderBy: { dueAt: "asc" },
  });
}

export async function createFollowUp(businessId: string, userId: string, input: FollowUpInput) {
  // Re-verify the lead belongs to this tenant before writing anything —
  // input.leadId came from a form and is never trusted on its own.
  await assertLeadBelongsToBusiness(businessId, input.leadId);

  return prisma.followUp.create({
    data: {
      leadId: input.leadId,
      userId,
      dueAt: input.dueAt,
      note: input.note,
    },
  });
}

export async function completeFollowUp(businessId: string, followUpId: string) {
  // Re-verify the follow-up itself belongs to this tenant before mutating it
  // — followUpId came from a form and is never trusted on its own.
  const followUp = await prisma.followUp.findFirst({
    where: { id: followUpId, lead: { businessId } },
    select: { id: true },
  });

  if (!followUp) {
    throw new Error("Follow-up not found.");
  }

  return prisma.followUp.update({
    where: { id: followUpId },
    data: { status: "DONE" },
  });
}

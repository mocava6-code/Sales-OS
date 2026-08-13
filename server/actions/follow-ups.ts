"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { followUpSchema } from "@/lib/validations/follow-up";
import { completeFollowUp, createFollowUp } from "@/server/services/follow-up-service";

export type FollowUpFormState =
  | { errors?: Record<string, string[] | undefined>; formError?: string }
  | undefined;

export async function createFollowUpAction(
  _prevState: FollowUpFormState,
  formData: FormData,
): Promise<FollowUpFormState> {
  const user = await verifySession();
  const leadId = String(formData.get("leadId") ?? "");

  const parsed = followUpSchema.safeParse({
    leadId,
    dueAt: formData.get("dueAt"),
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createFollowUp(user.businessId, user.id, parsed.data);
  } catch {
    return { formError: "No se pudo encontrar ese cliente." };
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  redirect(`/leads/${leadId}`);
}

export async function completeFollowUpAction(formData: FormData) {
  const user = await verifySession();
  const followUpId = String(formData.get("followUpId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");

  await completeFollowUp(user.businessId, followUpId);

  revalidatePath("/");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { leadSchema } from "@/lib/validations/lead";
import { createLead } from "@/server/services/lead-service";

export type LeadFormState = { errors?: Record<string, string[] | undefined> } | undefined;

export async function createLeadAction(
  _prevState: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const user = await verifySession();

  const parsed = leadSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    priority: formData.get("priority") || "NORMAL",
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const lead = await createLead(user.businessId, parsed.data);

  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}

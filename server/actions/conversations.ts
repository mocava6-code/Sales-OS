"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { conversationSchema } from "@/lib/validations/conversation";
import { logConversation } from "@/server/services/conversation-service";

export type ConversationFormState = { formError: string } | undefined;

export async function logConversationAction(
  _prevState: ConversationFormState,
  formData: FormData,
): Promise<ConversationFormState> {
  const user = await verifySession();

  const leadId = String(formData.get("leadId") ?? "");
  const directions = formData.getAll("direction").map(String);
  const contents = formData.getAll("content").map(String);
  const entries = directions.map((direction, index) => ({
    direction,
    content: contents[index] ?? "",
  }));

  const parsed = conversationSchema.safeParse({ leadId, entries });

  if (!parsed.success) {
    return { formError: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }

  try {
    await logConversation(user.businessId, user.id, parsed.data);
  } catch {
    return { formError: "That lead could not be found." };
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  redirect(`/leads/${leadId}`);
}

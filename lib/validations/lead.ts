import { z } from "zod";
import { InvalidPhoneNumberError, normalizePhoneToE164 } from "@/lib/phone";

export const leadSchema = z.object({
  name: z.string().trim().min(1, { error: "Name is required." }),
  // Kori Data Correctness Phase 1D — normalized to canonical E.164 here
  // (lib/phone.ts), the write boundary for manual lead creation. Accepts
  // Peru national format ("933517901") or full international format
  // ("+51933517901"); anything else is rejected rather than stored as an
  // un-normalized string that could silently duplicate an existing Lead.
  phone: z
    .string()
    .trim()
    .transform((value, ctx) => {
      try {
        return normalizePhoneToE164(value);
      } catch (error) {
        if (error instanceof InvalidPhoneNumberError) {
          ctx.addIssue("Enter a valid phone number.");
          return z.NEVER;
        }
        throw error;
      }
    }),
  priority: z.enum(["NORMAL", "HIGH"]).default("NORMAL"),
});

export type LeadInput = z.infer<typeof leadSchema>;

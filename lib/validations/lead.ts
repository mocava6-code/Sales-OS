import { z } from "zod";

const PHONE_REGEX = /^\+?[0-9]{7,15}$/;

export const leadSchema = z.object({
  name: z.string().trim().min(1, { error: "Name is required." }),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s()-]/g, ""))
    .refine((value) => PHONE_REGEX.test(value), {
      error: "Enter a valid phone number (7–15 digits, optional leading +).",
    }),
  priority: z.enum(["NORMAL", "HIGH"]).default("NORMAL"),
});

export type LeadInput = z.infer<typeof leadSchema>;

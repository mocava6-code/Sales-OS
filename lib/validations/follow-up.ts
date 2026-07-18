import { z } from "zod";

export const followUpSchema = z.object({
  leadId: z.string().min(1),
  dueAt: z
    .string()
    .min(1, { error: "Due date is required." })
    .transform((value, ctx) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        ctx.addIssue("Enter a valid date.");
        return z.NEVER;
      }
      return date;
    }),
  note: z.string().trim().optional(),
});

export type FollowUpInput = z.infer<typeof followUpSchema>;

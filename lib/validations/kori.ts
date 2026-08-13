import { z } from "zod";

// Mirrors nl-query-parser.ts's own MAX_QUESTION_LENGTH — validated again
// here, at the application-input boundary, so a too-long question is
// rejected as InvalidInputError (400, safe message) before ever reaching
// Kori's domain layer, consistent with this app's "validate input" step
// happening right after authentication.
const MAX_QUESTION_LENGTH = 500;

export const askKoriQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, { error: "Se requiere una pregunta." })
    .max(MAX_QUESTION_LENGTH, { error: `La pregunta no puede superar los ${MAX_QUESTION_LENGTH} caracteres.` }),
  timezone: z.string().trim().min(1).optional(),
});

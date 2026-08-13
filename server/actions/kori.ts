"use server";

// Thin Next.js server action wrapper. All the actual logic (auth,
// validation, dependency construction, NL parse -> query -> format,
// error mapping) lives in server/application/kori-actions.ts — this just
// exposes it as a "use server" entry point the Kori chat dock can call
// directly, the same pattern every other client-invoked action in this
// app already follows (server/actions/observer-console.ts, decisions.ts).

import { askKoriHandler } from "@/server/application/kori-actions";

export async function askKoriAction(rawInput: unknown) {
  return askKoriHandler(rawInput);
}

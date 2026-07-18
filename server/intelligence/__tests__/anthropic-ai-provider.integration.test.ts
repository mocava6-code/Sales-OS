import { describe, it } from "vitest";
import { analyzeConversation } from "../analyze-conversation";
import { createAIRouterFromEnv } from "../provider-factory";
import type { ConversationIntelligenceInput } from "../types";

// Real-network tests against the actual configured AI provider. Disabled by
// default and never gate `npm test` — they show up as skipped, not failed,
// unless explicitly opted into via RUN_REAL_AI_TESTS=true with real
// credentials configured. Uses exactly one real call.
const shouldRun =
  process.env.RUN_REAL_AI_TESTS === "true" &&
  Boolean(process.env.AI_PROVIDER) &&
  Boolean(process.env.AI_MODEL) &&
  Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!shouldRun)("Real AI provider integration (RUN_REAL_AI_TESTS=true)", () => {
  it("analyzes one small invented Spanish conversation end to end", async () => {
    const router = createAIRouterFromEnv();
    const aiProvider = router.getProvider();

    const input: ConversationIntelligenceInput = {
      tenantId: "integration-test",
      channel: "manual",
      rawText: "Hola, tengo una Hilux 2022 y quiero un body kit. ¿Tienen disponible?",
    };

    const result = await analyzeConversation(input, { aiProvider });

    console.log("[integration] Conversation Intelligence result:\n", JSON.stringify(result, null, 2));
  });
});

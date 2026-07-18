import "dotenv/config";
import { analyzeConversation } from "../analyze-conversation";
import { createAIRouterFromEnv } from "../provider-factory";
import { createMockAIProvider } from "../testing/mock-ai-provider";
import type { ConversationIntelligenceInput, ConversationIntelligenceResult } from "../types";

// Developer-only manual evaluation script. Uses invented conversations —
// never real customer data. Defaults to a mocked provider so it always runs
// without credentials (`npm run kori:evaluate`); set RUN_REAL_AI_TESTS=true
// with AI_PROVIDER, AI_MODEL, and the selected provider's credential (e.g.
// ANTHROPIC_API_KEY) configured to evaluate against the real model instead.
// Persists nothing to any database.

interface Scenario {
  name: string;
  rawText: string;
  /** Canned output for the mocked (default) run — a structural smoke test, not a claim about real model quality. */
  mockResponseJson: string;
}

function fact(value: unknown, evidence: unknown[] = [], confidence = value === null ? 0 : 0.85) {
  return { kind: "fact", value, confidence, evidence };
}

function inference(value: unknown, evidence: unknown[] = [], confidence = value === null ? 0 : 0.7, reasoning?: string) {
  return { kind: "inference", value, confidence, evidence, reasoning };
}

function evidenceOf(sourceId: string, excerpt: string) {
  return [{ sourceType: "conversation_message", sourceId, excerpt }];
}

const NULL_FACTS = {
  customerName: fact(null),
  customerContact: fact(null),
  vehicleBrand: fact(null),
  vehicleModel: fact(null),
  vehicleYear: fact(null),
  city: fact(null),
  quantity: fact(null),
  productRequested: fact(null),
};

const NULL_INFERENCES = {
  customerType: inference(null),
  productFamily: inference(null),
  compatibility: inference(null),
  buyingIntent: inference(null),
  sentiment: inference(null),
  estimatedProbabilityOfPurchase: inference(null),
  estimatedDealValue: inference(null),
  recommendedNextAction: inference(null),
  aiPriority: inference(null),
};

const scenarios: Scenario[] = [
  {
    name: "1. Toyota Hilux — model and year given, city missing",
    rawText: "Hola, tengo una Hilux 2022 y quiero cotizar un body kit.",
    mockResponseJson: JSON.stringify({
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
      facts: {
        ...NULL_FACTS,
        vehicleBrand: fact("Toyota", evidenceOf("message-0", "Hilux")),
        vehicleModel: fact("Hilux", evidenceOf("message-0", "Hilux")),
        vehicleYear: fact(2022, evidenceOf("message-0", "2022")),
        productRequested: fact("body kit", evidenceOf("message-0", "body kit")),
      },
      inferences: {
        ...NULL_INFERENCES,
        buyingIntent: inference("EXPLORING", evidenceOf("message-0", "quiero cotizar"), 0.7),
        recommendedNextAction: inference(
          { action: "Preguntar la ciudad del cliente", reason: "Falta la ciudad para calcular el envío" },
          evidenceOf("message-0", "Hilux 2022"),
        ),
      },
      objections: [],
      missingInformation: [{ field: "facts.city", reason: "not mentioned" }],
      warnings: [],
      draftResponse: {
        text: "¡Hola! Claro, contamos con body kit para tu Hilux 2022. ¿En qué ciudad te encuentras para calcular el envío?",
        evidence: evidenceOf("message-0", "Hilux 2022"),
      },
    }),
  },
  {
    name: "2. Ford Ranger — price asked, year missing",
    rawText: "Buenas, tengo una Ford Ranger, ¿cuánto cuesta el kit de conversión?",
    mockResponseJson: JSON.stringify({
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
      facts: {
        ...NULL_FACTS,
        vehicleBrand: fact("Ford", evidenceOf("message-0", "Ford Ranger")),
        vehicleModel: fact("Ranger", evidenceOf("message-0", "Ranger")),
        productRequested: fact("kit de conversión", evidenceOf("message-0", "kit de conversión")),
      },
      inferences: {
        ...NULL_INFERENCES,
        // Price is intentionally left null — no knowledge snippet supports one, and the prompt
        // forbids inventing prices. This is the correct behavior, not a gap in this scenario.
        buyingIntent: inference("COMPARING", evidenceOf("message-0", "cuánto cuesta"), 0.6),
        recommendedNextAction: inference(
          { action: "Preguntar el año del vehículo y compartir política de precios", reason: "Falta el año para confirmar compatibilidad y no hay tabla de precios cargada" },
          evidenceOf("message-0", "cuánto cuesta el kit de conversión"),
        ),
      },
      objections: [],
      missingInformation: [
        { field: "facts.vehicleYear", reason: "not mentioned" },
        { field: "inferences.estimatedDealValue", reason: "no pricing knowledge source configured" },
      ],
      warnings: [],
      draftResponse: {
        text: "¡Hola! Para darte el precio correcto del kit de conversión, ¿me confirmas el año de tu Ford Ranger?",
        evidence: evidenceOf("message-0", "Ford Ranger"),
      },
    }),
  },
  {
    name: "3. Vague customer — 'quiero información'",
    rawText: "Hola, quiero información.",
    mockResponseJson: JSON.stringify({
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
      facts: { ...NULL_FACTS },
      inferences: {
        ...NULL_INFERENCES,
        buyingIntent: inference("EXPLORING", evidenceOf("message-0", "quiero información"), 0.4),
        recommendedNextAction: inference(
          { action: "Preguntar qué vehículo tiene y qué producto busca", reason: "El mensaje no menciona marca, modelo ni producto" },
          evidenceOf("message-0", "quiero información"),
        ),
      },
      objections: [],
      missingInformation: [
        { field: "facts.vehicleBrand", reason: "not mentioned" },
        { field: "facts.vehicleModel", reason: "not mentioned" },
        { field: "facts.productRequested", reason: "not mentioned" },
      ],
      warnings: [],
      draftResponse: {
        text: "¡Hola! Con gusto te ayudo — ¿qué marca y modelo de vehículo tienes, y qué producto buscas?",
        evidence: evidenceOf("message-0", "quiero información"),
      },
    }),
  },
  {
    name: "4. Wholesale — multiple units requested",
    rawText: "Hola, somos una tienda y queremos comprar 50 kits de defensa para Hilux, ¿tienen para mayoreo?",
    mockResponseJson: JSON.stringify({
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
      facts: {
        ...NULL_FACTS,
        vehicleBrand: fact("Toyota", evidenceOf("message-0", "Hilux")),
        vehicleModel: fact("Hilux", evidenceOf("message-0", "Hilux")),
        quantity: fact(50, evidenceOf("message-0", "50 kits")),
        productRequested: fact("kits de defensa", evidenceOf("message-0", "kits de defensa")),
      },
      inferences: {
        ...NULL_INFERENCES,
        customerType: inference("WHOLESALE", evidenceOf("message-0", "mayoreo"), 0.85, "explicit wholesale request for 50 units"),
        buyingIntent: inference("READY_TO_BUY", evidenceOf("message-0", "queremos comprar"), 0.75),
        aiPriority: inference({ score: 85, label: "HIGH" }, evidenceOf("message-0", "50 kits de defensa"), 0.8, "large wholesale order, ready to buy"),
        recommendedNextAction: inference(
          { action: "Conectar con el representante de mayoreo y confirmar disponibilidad de 50 unidades", reason: "Pedido grande de mayoreo, alta prioridad" },
          evidenceOf("message-0", "50 kits de defensa para Hilux"),
        ),
      },
      objections: [],
      missingInformation: [],
      warnings: [],
      draftResponse: {
        text: "¡Hola! Sí, manejamos precios de mayoreo. Voy a confirmar disponibilidad de 50 kits de defensa para Hilux y te contacto con nuestro representante de mayoreo.",
        evidence: evidenceOf("message-0", "50 kits de defensa"),
      },
    }),
  },
  {
    name: "5. Unsupported compatibility claim — must be stripped by grounding, not repeated as fact",
    rawText: "Hola, tengo una F-150 2020, ¿el body kit le queda perfecto sin modificaciones?",
    // This mock deliberately misbehaves (as a real model occasionally might): it asserts
    // compatibility as if verified, citing a knowledge snippet that was never actually
    // retrieved (no knowledge source is configured in this phase). The point of this
    // scenario is to demonstrate that the grounding validator strips this claim to
    // unknown and adds a warning — Kori must not repeat it as a confirmed fact.
    mockResponseJson: JSON.stringify({
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
      facts: {
        ...NULL_FACTS,
        vehicleBrand: fact("Ford", evidenceOf("message-0", "F-150")),
        vehicleModel: fact("F-150", evidenceOf("message-0", "F-150")),
        vehicleYear: fact(2020, evidenceOf("message-0", "2020")),
        productRequested: fact("body kit", evidenceOf("message-0", "body kit")),
      },
      inferences: {
        ...NULL_INFERENCES,
        // Cites a knowledge item that does not exist in this run's context — the grounding
        // validator will demote this to null because no such snippet was ever retrieved.
        compatibility: inference("COMPATIBLE", [{ sourceType: "knowledge_item", sourceId: "kb-fit-f150-bodykit", excerpt: "fits without modification" }], 0.9),
        buyingIntent: inference("READY_TO_BUY", evidenceOf("message-0", "le queda perfecto"), 0.6),
      },
      objections: [],
      missingInformation: [],
      warnings: [],
      draftResponse: null,
    }),
  },
];

async function main() {
  const useReal =
    process.env.RUN_REAL_AI_TESTS === "true" &&
    Boolean(process.env.AI_PROVIDER) &&
    Boolean(process.env.AI_MODEL) &&
    Boolean(process.env.ANTHROPIC_API_KEY);

  console.log(
    useReal
      ? "Running against the REAL configured AI provider.\n"
      : "Running against a MOCKED provider (structural smoke test only — set RUN_REAL_AI_TESTS=true with credentials for real evaluation).\n",
  );

  for (const scenario of scenarios) {
    console.log(`\n=== ${scenario.name} ===`);
    console.log(`Input: "${scenario.rawText}"`);

    const aiProvider = useReal
      ? createAIRouterFromEnv().getProvider()
      : createMockAIProvider({ response: scenario.mockResponseJson }).provider;

    const input: ConversationIntelligenceInput = { tenantId: "manual-eval", channel: "manual", rawText: scenario.rawText };

    try {
      const result = await analyzeConversation(input, { aiProvider });
      printResult(result);
    } catch (error) {
      console.error("Analysis failed:", error);
    }
  }
}

function printResult(result: ConversationIntelligenceResult) {
  console.log("Facts:", JSON.stringify(result.facts, null, 2));
  console.log("Inferences:", JSON.stringify(result.inferences, null, 2));
  console.log("Objections:", JSON.stringify(result.objections, null, 2));
  console.log("Missing information:", JSON.stringify(result.missingInformation, null, 2));
  console.log("Warnings:", JSON.stringify(result.warnings, null, 2));
  console.log("Draft response:", JSON.stringify(result.draftResponse, null, 2));
  console.log("Overall confidence:", result.overallConfidence);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

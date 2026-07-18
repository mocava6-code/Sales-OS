import type { KoriDecisionContext } from "./types";

/**
 * Anything the decision reasoning capability may cite as evidence besides a
 * raw conversation message: pre-verified Conversation Intelligence facts,
 * supplied business facts/rules, or prior interactions. Built once per call
 * and used both to render the prompt and to validate evidence references
 * against (see ./validator.ts) — one source of truth for "what's citable."
 */
export interface CitableKnowledgeItem {
  id: string;
  content: string;
}

export function buildCitableKnowledgeItems(context: KoriDecisionContext): CitableKnowledgeItem[] {
  const items: CitableKnowledgeItem[] = [];

  const ci = context.conversationIntelligence;
  if (ci) {
    for (const [field, fact] of Object.entries(ci.facts)) {
      if (fact.value !== null) {
        items.push({ id: `ci-fact:${field}`, content: `${field}: ${JSON.stringify(fact.value)}` });
      }
    }
    for (const [field, inference] of Object.entries(ci.inferences)) {
      if (inference.value !== null) {
        items.push({ id: `ci-inference:${field}`, content: `${field}: ${JSON.stringify(inference.value)}` });
      }
    }
  }

  for (const fact of context.knownCustomerFacts ?? []) {
    items.push({ id: `known-customer-fact:${fact.key}`, content: `${fact.key}: ${fact.value}` });
  }

  for (const fact of context.knownProductFacts ?? []) {
    items.push({ id: `known-product-fact:${fact.key}`, content: `${fact.key}: ${fact.value}` });
  }

  for (const rule of context.knownBusinessRules ?? []) {
    items.push({ id: `business-rule:${rule.key}`, content: rule.description });
  }

  (context.previousInteractions ?? []).forEach((interaction, index) => {
    items.push({
      id: `previous-interaction:${index}`,
      content: `${interaction.summary}${interaction.outcome ? ` (outcome: ${interaction.outcome})` : ""}`,
    });
  });

  return items;
}

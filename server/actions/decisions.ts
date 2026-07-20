"use server";

// Thin Next.js server action wrappers. All the actual logic (auth,
// validation, dependency construction, orchestration call, error mapping)
// lives in server/application/decision-actions.ts — these just expose it
// as "use server" entry points with the real (non-fake) dependencies.

import {
  analyzeConversationHandler,
  approveDecisionHandler,
  executeDecisionHandler,
  recordAdvisorOverrideHandler,
  recordConversationAbandonedHandler,
  recordCustomerReplyHandler,
  recordFollowUpSentHandler,
  recordQuotationRequestedHandler,
  recordQuotationSentHandler,
  recordSaleClosedHandler,
  recordSaleLostHandler,
  rejectDecisionHandler,
} from "@/server/application/decision-actions";

export async function analyzeConversationAction(rawInput: unknown) {
  return analyzeConversationHandler(rawInput);
}

export async function approveDecisionAction(rawInput: unknown) {
  return approveDecisionHandler(rawInput);
}

export async function rejectDecisionAction(rawInput: unknown) {
  return rejectDecisionHandler(rawInput);
}

export async function executeDecisionAction(rawInput: unknown) {
  return executeDecisionHandler(rawInput);
}

export async function recordAdvisorOverrideAction(rawInput: unknown) {
  return recordAdvisorOverrideHandler(rawInput);
}

export async function recordCustomerReplyAction(rawInput: unknown) {
  return recordCustomerReplyHandler(rawInput);
}

export async function recordFollowUpSentAction(rawInput: unknown) {
  return recordFollowUpSentHandler(rawInput);
}

export async function recordQuotationRequestedAction(rawInput: unknown) {
  return recordQuotationRequestedHandler(rawInput);
}

export async function recordQuotationSentAction(rawInput: unknown) {
  return recordQuotationSentHandler(rawInput);
}

export async function recordSaleClosedAction(rawInput: unknown) {
  return recordSaleClosedHandler(rawInput);
}

export async function recordSaleLostAction(rawInput: unknown) {
  return recordSaleLostHandler(rawInput);
}

export async function recordConversationAbandonedAction(rawInput: unknown) {
  return recordConversationAbandonedHandler(rawInput);
}

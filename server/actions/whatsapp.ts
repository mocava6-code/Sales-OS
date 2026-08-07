"use server";

// Thin Next.js server action wrappers. All the actual logic lives in
// server/application/whatsapp-actions.ts — see server/actions/decisions.ts
// for the same pattern. No Meta SDK is ever imported here or reachable from
// the client.

import {
  approveWhatsAppReplyHandler,
  queueWhatsAppReplyHandler,
  registerWhatsAppPhoneNumberHandler,
  rejectWhatsAppReplyHandler,
  sendQueuedReplyHandler,
} from "@/server/application/whatsapp-actions";

export async function registerWhatsAppPhoneNumberAction(rawInput: unknown) {
  return registerWhatsAppPhoneNumberHandler(rawInput);
}

export async function queueWhatsAppReplyAction(rawInput: unknown) {
  return queueWhatsAppReplyHandler(rawInput);
}

export async function approveWhatsAppReplyAction(rawInput: unknown) {
  return approveWhatsAppReplyHandler(rawInput);
}

export async function rejectWhatsAppReplyAction(rawInput: unknown) {
  return rejectWhatsAppReplyHandler(rawInput);
}

export async function sendQueuedReplyAction(rawInput: unknown) {
  return sendQueuedReplyHandler(rawInput);
}

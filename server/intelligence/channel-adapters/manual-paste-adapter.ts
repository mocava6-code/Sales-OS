import type { ChannelAdapter } from "../channel-adapter";
import type { NormalizedMessage } from "../types";

// Deterministic placeholder parser for Phase B's pipeline shell. Each
// non-empty line of pasted text becomes one message. A line prefixed with
// "OUT:" (case-insensitive) is the rep's own message; everything else
// defaults to INBOUND, since "someone wrote to me" is the dominant case
// this product is built around. Real WhatsApp/email transcript parsing
// (timestamps, contact names, multi-line messages) is a separate, later
// concern and is deliberately not attempted here.
const OUTBOUND_PREFIX = /^out:\s*/i;

export const manualPasteChannelAdapter: ChannelAdapter = {
  channel: "manual",

  normalize(rawInput: string): NormalizedMessage[] {
    const now = Date.now();

    return rawInput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index): NormalizedMessage => {
        const isOutbound = OUTBOUND_PREFIX.test(line);
        return {
          direction: isOutbound ? "OUTBOUND" : "INBOUND",
          content: line.replace(OUTBOUND_PREFIX, "").trim(),
          // Offset by index so occurredAt preserves paste order, mirroring
          // the existing conversation-service pattern for manual entries.
          occurredAt: new Date(now + index),
        };
      });
  },
};

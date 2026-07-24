// Observer Mode v1 — the domain event vocabulary. Prisma-free by design: a
// leaf module like server/intelligence/types.ts, imported by
// server/whatsapp/**, server/intelligence/observation/**, and
// server/orchestration/**, but owned by none of them. See ARCHITECTURE.md §19.

export interface DomainEventBase {
  businessId: string;
  conversationId: string;
  occurredAt: Date;
}

export interface ConversationCreatedEvent extends DomainEventBase {
  type: "CONVERSATION_CREATED";
  leadId: string;
  channel: string;
  source: string;
}

export interface MessageReceivedEvent extends DomainEventBase {
  type: "MESSAGE_RECEIVED";
  conversationEntryId: string;
  messageType: string;
  content: string;
  externalId?: string;
  /**
   * Supplied by the caller (the gateway already has the full entry list
   * loaded) — the Observation Engine never queries the database itself.
   * Absent for the first message in a conversation.
   */
  previousEntry?: { direction: "INBOUND" | "OUTBOUND"; occurredAt: Date };
}

export interface MessageSentEvent extends DomainEventBase {
  type: "MESSAGE_SENT";
  conversationEntryId: string;
  content: string;
  externalId?: string;
}

export interface AttachmentReceivedEvent extends DomainEventBase {
  type: "ATTACHMENT_RECEIVED";
  conversationEntryId: string;
  mediaType: string;
  mimeType?: string;
  caption?: string;
}

export interface ConversationClosedEvent extends DomainEventBase {
  type: "CONVERSATION_CLOSED";
  lastEntryDirection: "INBOUND" | "OUTBOUND";
  lastEntryAt: Date;
}

export type DomainEvent =
  | ConversationCreatedEvent
  | MessageReceivedEvent
  | MessageSentEvent
  | AttachmentReceivedEvent
  | ConversationClosedEvent;

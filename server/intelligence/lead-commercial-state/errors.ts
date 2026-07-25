// Mirrors the same convention used everywhere else in this codebase
// (server/intelligence/errors.ts, server/orchestration/errors.ts,
// server/whatsapp/errors.ts): an abstract base with a `.code`,
// instanceof-checkable, name = new.target.name.

export abstract class LeadCommercialStateError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** deriveLeadCommercialState requires at least one conversation to resolve an active conversation from — a lead with none has nothing to derive state from. */
export class NoConversationsForLeadError extends LeadCommercialStateError {
  readonly code = "NO_CONVERSATIONS_FOR_LEAD";

  constructor(public readonly leadId: string) {
    super(`Lead "${leadId}" has no conversations — there is no commercial state to derive yet.`);
  }
}

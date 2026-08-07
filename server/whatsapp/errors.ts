// WhatsApp integration errors. Mirrors the same convention used everywhere
// else in this codebase (server/intelligence/errors.ts, server/orchestration/errors.ts):
// an abstract base with a `.code`, instanceof-checkable, name = new.target.name.

export abstract class WhatsAppError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The GET verification handshake's hub.verify_token didn't match, or hub.mode wasn't "subscribe". */
export class WebhookVerificationFailedError extends WhatsAppError {
  readonly code = "WEBHOOK_VERIFICATION_FAILED";

  constructor(message = "WhatsApp webhook verification failed.") {
    super(message);
  }
}

/** X-Hub-Signature-256 was missing or didn't match the computed HMAC — the payload is never trusted blindly. */
export class InvalidWebhookSignatureError extends WhatsAppError {
  readonly code = "INVALID_WEBHOOK_SIGNATURE";

  constructor(message = "WhatsApp webhook signature is missing or invalid.") {
    super(message);
  }
}

export class InvalidWebhookPayloadError extends WhatsAppError {
  readonly code = "INVALID_WEBHOOK_PAYLOAD";

  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}

/** metadata.phone_number_id in the payload doesn't match any WhatsAppPhoneNumber we have on file. */
export class UnknownPhoneNumberError extends WhatsAppError {
  readonly code = "UNKNOWN_PHONE_NUMBER";

  constructor(public readonly phoneNumberId: string) {
    super(`No business has phone_number_id "${phoneNumberId}" registered.`);
  }
}

/** phoneNumberId already has a WhatsAppPhoneNumber row — the unique index is the actual source of truth, this is just its typed surface. */
export class DuplicatePhoneNumberError extends WhatsAppError {
  readonly code = "DUPLICATE_PHONE_NUMBER";

  constructor(public readonly phoneNumberId: string) {
    super(`A WhatsApp number with phone_number_id "${phoneNumberId}" is already registered.`);
  }
}

export class PendingMessageNotFoundError extends WhatsAppError {
  readonly code = "PENDING_MESSAGE_NOT_FOUND";

  constructor(public readonly pendingMessageId: string) {
    super(`No PendingWhatsAppMessage found with id "${pendingMessageId}".`);
  }
}

export class InvalidPendingMessageStatusTransitionError extends WhatsAppError {
  readonly code = "INVALID_PENDING_MESSAGE_STATUS_TRANSITION";

  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot transition a pending WhatsApp message from "${from}" to "${to}".`);
  }
}

/** The Graph API call to send a message failed. See `.cause` for the underlying fetch/response error. */
export class WhatsAppSendFailedError extends WhatsAppError {
  readonly code = "WHATSAPP_SEND_FAILED";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

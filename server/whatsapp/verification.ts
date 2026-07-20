import "server-only";

import { timingSafeEqual, createHmac } from "node:crypto";
import { InvalidWebhookSignatureError, WebhookVerificationFailedError } from "./errors";

/**
 * The one-time GET handshake Meta performs when you configure a webhook URL
 * in the App Dashboard: it sends hub.mode=subscribe, hub.verify_token (the
 * value you configured), and hub.challenge (a random string). Responding
 * with hub.challenge verbatim — and only when the token matches — proves we
 * control this URL.
 */
export function verifyWebhookSubscription(
  query: { mode: string | null; verifyToken: string | null; challenge: string | null },
  expectedVerifyToken: string,
): string {
  if (query.mode !== "subscribe" || query.verifyToken !== expectedVerifyToken || !query.challenge) {
    throw new WebhookVerificationFailedError();
  }
  return query.challenge;
}

/**
 * Every webhook POST must carry X-Hub-Signature-256: sha256=<hex hmac of the
 * raw body, keyed with the app secret>. This is Meta's request signing, not
 * ours — the payload is never processed without this check, regardless of
 * where it appears to originate from. Constant-time comparison guards
 * against timing side-channels; a mismatched HMAC length is treated as
 * invalid rather than thrown from timingSafeEqual.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): void {
  if (!signatureHeader) {
    throw new InvalidWebhookSignatureError("Missing X-Hub-Signature-256 header.");
  }

  const [scheme, providedHex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !providedHex) {
    throw new InvalidWebhookSignatureError("X-Hub-Signature-256 header is malformed.");
  }

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new InvalidWebhookSignatureError();
  }
}

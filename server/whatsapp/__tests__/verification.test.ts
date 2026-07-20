import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidWebhookSignatureError, WebhookVerificationFailedError } from "../errors";
import { verifyWebhookSignature, verifyWebhookSubscription } from "../verification";

const APP_SECRET = "test-app-secret";

function sign(body: string, secret: string = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyWebhookSubscription — 1. webhook verification", () => {
  it("returns the challenge when mode is subscribe and the token matches", () => {
    const challenge = verifyWebhookSubscription(
      { mode: "subscribe", verifyToken: "secret-token", challenge: "12345" },
      "secret-token",
    );
    expect(challenge).toBe("12345");
  });

  it("throws WebhookVerificationFailedError when the token doesn't match", () => {
    expect(() =>
      verifyWebhookSubscription({ mode: "subscribe", verifyToken: "wrong", challenge: "12345" }, "secret-token"),
    ).toThrow(WebhookVerificationFailedError);
  });

  it("throws WebhookVerificationFailedError when mode isn't subscribe", () => {
    expect(() =>
      verifyWebhookSubscription({ mode: "unsubscribe", verifyToken: "secret-token", challenge: "12345" }, "secret-token"),
    ).toThrow(WebhookVerificationFailedError);
  });

  it("throws WebhookVerificationFailedError when challenge is missing", () => {
    expect(() =>
      verifyWebhookSubscription({ mode: "subscribe", verifyToken: "secret-token", challenge: null }, "secret-token"),
    ).toThrow(WebhookVerificationFailedError);
  });
});

describe("verifyWebhookSignature — signature validation, never trusting payloads blindly", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect(() => verifyWebhookSignature(body, sign(body), APP_SECRET)).not.toThrow();
  });

  it("throws InvalidWebhookSignatureError when the header is missing", () => {
    const body = "{}";
    expect(() => verifyWebhookSignature(body, null, APP_SECRET)).toThrow(InvalidWebhookSignatureError);
  });

  it("throws InvalidWebhookSignatureError when the scheme isn't sha256", () => {
    const body = "{}";
    expect(() => verifyWebhookSignature(body, "sha1=deadbeef", APP_SECRET)).toThrow(InvalidWebhookSignatureError);
  });

  it("throws InvalidWebhookSignatureError when the HMAC doesn't match", () => {
    const body = JSON.stringify({ a: 1 });
    const tamperedBody = JSON.stringify({ a: 2 });
    expect(() => verifyWebhookSignature(tamperedBody, sign(body), APP_SECRET)).toThrow(InvalidWebhookSignatureError);
  });

  it("throws InvalidWebhookSignatureError when signed with the wrong secret", () => {
    const body = JSON.stringify({ a: 1 });
    expect(() => verifyWebhookSignature(body, sign(body, "different-secret"), APP_SECRET)).toThrow(
      InvalidWebhookSignatureError,
    );
  });

  it("throws InvalidWebhookSignatureError for a malformed header with no hex digest", () => {
    expect(() => verifyWebhookSignature("{}", "sha256=", APP_SECRET)).toThrow(InvalidWebhookSignatureError);
  });
});

import { NextResponse, type NextRequest } from "next/server";
import { InvalidWebhookPayloadError, InvalidWebhookSignatureError, WebhookVerificationFailedError } from "@/server/whatsapp/errors";
import { createWhatsAppGateway } from "@/server/whatsapp/gateway";
import { handleVerificationRequest, handleWebhookEvent } from "@/server/whatsapp/webhook";

// Thin HTTP adapter — all real logic lives in server/whatsapp/webhook.ts.
// This file only translates between Next.js's request/response and that
// module's plain string/object interface.

export async function GET(request: NextRequest) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error("[whatsapp webhook] WHATSAPP_VERIFY_TOKEN is not configured.");
    return new NextResponse("Webhook not configured.", { status: 500 });
  }

  const { searchParams } = request.nextUrl;

  try {
    const challenge = handleVerificationRequest(
      {
        mode: searchParams.get("hub.mode"),
        verifyToken: searchParams.get("hub.verify_token"),
        challenge: searchParams.get("hub.challenge"),
      },
      verifyToken,
    );
    return new NextResponse(challenge, { status: 200 });
  } catch (error) {
    if (error instanceof WebhookVerificationFailedError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("[whatsapp webhook] WHATSAPP_APP_SECRET is not configured.");
    return new NextResponse("Webhook not configured.", { status: 500 });
  }

  // Raw text first — signature verification needs the exact bytes Meta
  // signed, before any JSON parsing.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");

  try {
    const summary = await handleWebhookEvent(rawBody, signatureHeader, {
      appSecret,
      gateway: createWhatsAppGateway(),
    });

    if (summary.errors.length > 0) {
      console.error("[whatsapp webhook] processed with per-item errors:", summary.errors);
    }

    // Always 200 once the payload is verified and parsed — Meta retries
    // aggressively on non-2xx, and per-item failures are already captured
    // above rather than being retry-worthy at the whole-batch level.
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return new NextResponse("Forbidden", { status: 401 });
    }
    if (error instanceof InvalidWebhookPayloadError) {
      return new NextResponse("Bad Request", { status: 400 });
    }
    console.error("[whatsapp webhook] unexpected error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

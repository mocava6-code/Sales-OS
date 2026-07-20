import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppSendFailedError } from "../errors";
import { createMetaWhatsAppSenderClient } from "../sender";

// Mocks Meta's API — never calls the real WhatsApp Graph API.
describe("createMetaWhatsAppSenderClient — 9. sending messages (mocked Graph API)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the correct Graph API URL with the expected body and auth header", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ messages: [{ id: "wamid.SENT1" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createMetaWhatsAppSenderClient({ accessToken: "test-token", apiVersion: "v21.0" });
    const result = await client.sendTextMessage({ phoneNumberId: "1234567890", to: "16315551234", body: "Hola" });

    expect(result).toEqual({ externalId: "wamid.SENT1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect(JSON.parse(init?.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "16315551234",
      type: "text",
      text: { body: "Hola" },
    });
  });

  it("respects a custom baseUrl override", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createMetaWhatsAppSenderClient({ accessToken: "t", baseUrl: "https://graph.test.local" });
    await client.sendTextMessage({ phoneNumberId: "111", to: "222", body: "hi" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.test.local/v21.0/111/messages");
  });

  it("throws WhatsAppSendFailedError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Invalid parameter", { status: 400 })),
    );

    const client = createMetaWhatsAppSenderClient({ accessToken: "test-token" });

    await expect(client.sendTextMessage({ phoneNumberId: "1", to: "2", body: "hi" })).rejects.toBeInstanceOf(
      WhatsAppSendFailedError,
    );
  });

  it("throws WhatsAppSendFailedError when the response has no message id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );

    const client = createMetaWhatsAppSenderClient({ accessToken: "test-token" });

    await expect(client.sendTextMessage({ phoneNumberId: "1", to: "2", body: "hi" })).rejects.toBeInstanceOf(
      WhatsAppSendFailedError,
    );
  });

  it("throws WhatsAppSendFailedError on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const client = createMetaWhatsAppSenderClient({ accessToken: "test-token" });

    await expect(client.sendTextMessage({ phoneNumberId: "1", to: "2", body: "hi" })).rejects.toBeInstanceOf(
      WhatsAppSendFailedError,
    );
  });
});

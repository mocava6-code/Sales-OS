import { describe, expect, it } from "vitest";
import { isMetaAdContextMessage, tokenizeWhatsAppExport } from "../tokenizer";

// Verbatim from a real production WhatsApp Business export that failed to
// import — see server/knowledge/whatsapp-import/__tests__ production-import
// regression tests below and in parser.test.ts/role-resolver.test.ts for
// the full pipeline against this exact text.
const PRODUCTION_SAMPLE = [
  "11/8/2026, 6:11 p. m. - Tu empresa usa un servicio seguro de Meta para administrar este chat. Toca para obtener más información.",
  "11/8/2026, 6:11 p. m. -",
  "11/8/2026, 6:11 p. m. - Koriaki Import: Anuncio de Facebook Ver detalles Hi ! Please let us know how we can help you.",
  "11/8/2026, 6:11 p. m. - +51 933 888 197: Hola",
  "11/8/2026, 6:12 p. m. - +51 933 888 197: Estoy interesado en el Kit de Conversión para una Ford Ranger XLT 2019 a la versión Raptor",
  "11/8/2026, 9:16 p. m. - Este chat se inició a partir de un anuncio de Facebook o Instagram...",
  "11/8/2026, 9:16 p. m. - Koriaki Import: ¡Hola! ¿Que tal?",
  "Le saluda Maria Chaca asesora de Koriaki Import 😊",
].join("\n");

describe("tokenizeWhatsAppExport — Android format", () => {
  it("parses a basic 24h Android line into a MESSAGE token", () => {
    const [token] = tokenizeWhatsAppExport("27/07/26, 14:05 - María López: Sí, el TRAVO sirve para Hilux Revo desde 2016.");

    expect(token).toMatchObject({
      kind: "MESSAGE",
      dateRaw: "27/07/26",
      timeRaw: "14:05",
      senderLabel: "María López",
      content: "Sí, el TRAVO sirve para Hilux Revo desde 2016.",
    });
  });

  it("parses Spanish 12h AM/PM markers with a narrow-no-break space", () => {
    const [token] = tokenizeWhatsAppExport("27/07/26, 2:05 p. m. - Juan Pérez: Ok gracias");

    expect(token.timeRaw).toContain("p");
    expect(token.senderLabel).toBe("Juan Pérez");
  });

  it("handles a 4-digit year", () => {
    const [token] = tokenizeWhatsAppExport("27/07/2026, 14:05 - María: Hola");
    expect(token.dateRaw).toBe("27/07/2026");
  });
});

describe("tokenizeWhatsAppExport — iOS format", () => {
  it("parses a bracketed iOS line with seconds", () => {
    const [token] = tokenizeWhatsAppExport("[27/07/26, 14:05:32] María López: Sí, el TRAVO sirve.");

    expect(token).toMatchObject({
      kind: "MESSAGE",
      dateRaw: "27/07/26",
      timeRaw: "14:05:32",
      senderLabel: "María López",
      content: "Sí, el TRAVO sirve.",
    });
  });
});

describe("tokenizeWhatsAppExport — system messages", () => {
  it("classifies the encryption notice as SYSTEM, not a message from a sender", () => {
    const [token] = tokenizeWhatsAppExport(
      "27/07/26, 14:00 - Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos.",
    );

    expect(token.kind).toBe("SYSTEM");
    expect(token.senderLabel).toBeNull();
  });

  it("classifies a group-membership change line as SYSTEM", () => {
    const [token] = tokenizeWhatsAppExport("27/07/26, 14:00 - María López creó el grupo \"Clientes Koriaki\"");
    expect(token.kind).toBe("SYSTEM");
  });

  it("still classifies a real message containing a colon in its content as MESSAGE", () => {
    const [token] = tokenizeWhatsAppExport("27/07/26, 14:05 - María López: Precio: S/450");

    expect(token.kind).toBe("MESSAGE");
    expect(token.senderLabel).toBe("María López");
    expect(token.content).toBe("Precio: S/450");
  });
});

describe("tokenizeWhatsAppExport — multi-line messages", () => {
  it("appends continuation lines (no timestamp prefix) to the previous message", () => {
    const raw = ["27/07/26, 14:05 - María López: Estos son los precios:", "Kit básico: S/300", "Kit completo: S/450"].join("\n");

    const tokens = tokenizeWhatsAppExport(raw);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toBe("Estos son los precios:\nKit básico: S/300\nKit completo: S/450");
  });

  it("keeps separately-timestamped messages as separate tokens", () => {
    const raw = ["27/07/26, 14:05 - María López: Hola", "27/07/26, 14:06 - Juan Pérez: Hola, quiero cotizar"].join("\n");

    const tokens = tokenizeWhatsAppExport(raw);

    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.senderLabel)).toEqual(["María López", "Juan Pérez"]);
  });

  it("skips a stray line before any timestamp has matched", () => {
    const raw = ["random header junk", "27/07/26, 14:05 - María López: Hola"].join("\n");

    const tokens = tokenizeWhatsAppExport(raw);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].content).toBe("Hola");
  });
});

describe("tokenizeWhatsAppExport — a timestamped line with nothing after the dash", () => {
  it("becomes its own empty SYSTEM token instead of being swallowed into the previous message", () => {
    const raw = ["27/07/26, 14:05 - Juan Pérez: Hola", "27/07/26, 14:06 -", "27/07/26, 14:07 - María López: Hola"].join("\n");

    const tokens = tokenizeWhatsAppExport(raw);

    expect(tokens).toHaveLength(3);
    expect(tokens[0].content).toBe("Hola");
    expect(tokens[1]).toMatchObject({ kind: "SYSTEM", content: "" });
    expect(tokens[2].content).toBe("Hola");
  });

  it("never merges the empty line into the previous message's content", () => {
    const raw = ["27/07/26, 14:05 - Juan Pérez: Hola", "27/07/26, 14:06 -"].join("\n");
    const tokens = tokenizeWhatsAppExport(raw);
    expect(tokens[0].content).toBe("Hola");
    expect(tokens[0].content).not.toContain("14:06");
  });

  it("handles an empty line at the very end of the export", () => {
    const raw = ["27/07/26, 14:05 - Juan Pérez: Hola", "27/07/26, 14:06 -"].join("\n");
    const tokens = tokenizeWhatsAppExport(raw);
    expect(tokens).toHaveLength(2);
    expect(tokens[1].kind).toBe("SYSTEM");
  });
});

describe("isMetaAdContextMessage", () => {
  it("recognizes the Facebook ad-context auto-insertion", () => {
    expect(isMetaAdContextMessage("Anuncio de Facebook Ver detalles Hi ! Please let us know how we can help you.")).toBe(true);
  });

  it("recognizes the Instagram variant", () => {
    expect(isMetaAdContextMessage("Anuncio de Instagram Ver detalles")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMetaAdContextMessage("anuncio de facebook ver detalles")).toBe(true);
  });

  it("never matches a real human message, even one that mentions Facebook", () => {
    expect(isMetaAdContextMessage("Vi tu anuncio de Facebook y quiero cotizar un kit")).toBe(false);
    expect(isMetaAdContextMessage("Hola, ¿tienen el kit disponible?")).toBe(false);
  });
});

describe("tokenizeWhatsAppExport — Meta ad-context auto-insertion", () => {
  it("classifies the business-prefixed ad-context line as SYSTEM, never a real BUSINESS message", () => {
    const [token] = tokenizeWhatsAppExport(
      "11/8/2026, 6:11 p. m. - Koriaki Import: Anuncio de Facebook Ver detalles Hi ! Please let us know how we can help you.",
    );
    expect(token.kind).toBe("SYSTEM");
    expect(token.senderLabel).toBeNull();
  });

  it("still classifies a real message from the same sender as MESSAGE", () => {
    const [token] = tokenizeWhatsAppExport("11/8/2026, 9:16 p. m. - Koriaki Import: ¡Hola! ¿Que tal?");
    expect(token.kind).toBe("MESSAGE");
    expect(token.senderLabel).toBe("Koriaki Import");
  });
});

describe("tokenizeWhatsAppExport — production regression (real WhatsApp Business export)", () => {
  it("produces exactly the two real message-bearing participants, never a phantom third from a misparsed system line", () => {
    const tokens = tokenizeWhatsAppExport(PRODUCTION_SAMPLE);
    const messageTokens = tokens.filter((t) => t.kind === "MESSAGE");
    const participantLabels = [...new Set(messageTokens.map((t) => t.senderLabel))];

    expect(participantLabels.sort()).toEqual(["+51 933 888 197", "Koriaki Import"].sort());
  });

  it("excludes the ad-context auto-message from the business's real message content", () => {
    const tokens = tokenizeWhatsAppExport(PRODUCTION_SAMPLE);
    const koriakiMessages = tokens.filter((t) => t.kind === "MESSAGE" && t.senderLabel === "Koriaki Import");
    expect(koriakiMessages.every((t) => !t.content.toLowerCase().includes("anuncio de facebook"))).toBe(true);
  });

  it("merges the multi-line closing message into a single token with the advisor's signature intact", () => {
    const tokens = tokenizeWhatsAppExport(PRODUCTION_SAMPLE);
    const closing = tokens.find((t) => t.content.includes("Le saluda Maria Chaca"));
    expect(closing?.content).toBe("¡Hola! ¿Que tal?\nLe saluda Maria Chaca asesora de Koriaki Import 😊");
  });
});

describe("tokenizeWhatsAppExport — provenance", () => {
  it("preserves the original raw line(s) verbatim, joined across continuations", () => {
    const raw = ["27/07/26, 14:05 - María López: Línea 1", "Línea 2"].join("\n");

    const [token] = tokenizeWhatsAppExport(raw);

    expect(token.rawLine).toBe("27/07/26, 14:05 - María López: Línea 1\nLínea 2");
  });
});

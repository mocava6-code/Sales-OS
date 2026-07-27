import { describe, expect, it } from "vitest";
import { tokenizeWhatsAppExport } from "../tokenizer";

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

describe("tokenizeWhatsAppExport — provenance", () => {
  it("preserves the original raw line(s) verbatim, joined across continuations", () => {
    const raw = ["27/07/26, 14:05 - María López: Línea 1", "Línea 2"].join("\n");

    const [token] = tokenizeWhatsAppExport(raw);

    expect(token.rawLine).toBe("27/07/26, 14:05 - María López: Línea 1\nLínea 2");
  });
});

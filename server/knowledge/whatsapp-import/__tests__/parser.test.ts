import { describe, expect, it } from "vitest";
import { parseWhatsAppExport } from "../parser";

const BASE_INPUT = { dateOrder: "DMY" as const, timezone: "America/Lima", knownBusinessNames: ["María López"] };

describe("parseWhatsAppExport — end to end", () => {
  it("parses a full 1:1 export with deterministic role resolution", () => {
    const rawText = [
      "27/07/26, 14:00 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
      "27/07/26, 14:05 - Juan Pérez: Hola, quiero saber si el TRAVO sirve para mi Hilux 2018",
      "27/07/26, 14:06 - María López: Sí, el TRAVO sirve para Hilux Revo desde 2016.",
      "27/07/26, 14:07 - Juan Pérez: Perfecto, ¿lo tienen en stock?",
    ].join("\n");

    const result = parseWhatsAppExport({ ...BASE_INPUT, rawText });

    expect(result.needsParticipantResolution).toBe(false);
    if (result.needsParticipantResolution) throw new Error("unreachable");

    expect(result.systemMessageCount).toBe(1);
    expect(result.messages).toHaveLength(3);
    expect(result.resolution).toEqual({ needsInput: false, method: "DETERMINISTIC_USER_MATCH", businessSenderLabel: "María López" });
    expect(result.messages.map((m) => m.resolvedRole)).toEqual(["CUSTOMER", "BUSINESS", "CUSTOMER"]);
    expect(result.messages[1].content).toBe("Sí, el TRAVO sirve para Hilux Revo desde 2016.");
    expect(result.warnings).toHaveLength(0);
  });

  it("assigns sequenceIndex in source order and never fabricates occurredAt on a bad timestamp", () => {
    const rawText = [
      "27/07/26, 14:05 - Juan Pérez: primero",
      "not-a-real-timestamp-line", // becomes a continuation of the previous message
      "27/07/26, 14:06 - María López: segundo",
    ].join("\n");

    const result = parseWhatsAppExport({ ...BASE_INPUT, rawText });
    if (result.needsParticipantResolution) throw new Error("unreachable");

    expect(result.messages.map((m) => m.sequenceIndex)).toEqual([0, 1]);
    expect(result.messages.every((m) => m.occurredAt !== null)).toBe(true);
  });

  it("requires participant resolution for an unmatched 1:1 chat instead of guessing", () => {
    const rawText = ["27/07/26, 14:05 - Ana Torres: Hola", "27/07/26, 14:06 - Carlos Ruiz: Hola, tengo una consulta"].join("\n");

    const result = parseWhatsAppExport({ ...BASE_INPUT, knownBusinessNames: [], rawText });

    expect(result.needsParticipantResolution).toBe(true);
    if (!result.needsParticipantResolution) throw new Error("unreachable");
    expect(result.candidateLabels).toEqual(["Ana Torres", "Carlos Ruiz"]);
  });

  it("re-invoked with the manual answer resolves roles without re-asking", () => {
    const rawText = ["27/07/26, 14:05 - Ana Torres: Hola", "27/07/26, 14:06 - Carlos Ruiz: Hola, tengo una consulta"].join("\n");

    const result = parseWhatsAppExport({ ...BASE_INPUT, knownBusinessNames: [], rawText, manualBusinessSenderLabel: "Ana Torres" });

    expect(result.needsParticipantResolution).toBe(false);
    if (result.needsParticipantResolution) throw new Error("unreachable");
    expect(result.resolution).toMatchObject({ method: "MANUAL_PROMPT", businessSenderLabel: "Ana Torres" });
    expect(result.messages.map((m) => m.resolvedRole)).toEqual(["BUSINESS", "CUSTOMER"]);
  });

  it("leaves every message UNKNOWN for a group chat, never fabricating BUSINESS/CUSTOMER", () => {
    const rawText = [
      "27/07/26, 14:05 - Ana Torres: Hola a todos",
      "27/07/26, 14:06 - Carlos Ruiz: Hola",
      "27/07/26, 14:07 - María López: Hola equipo",
    ].join("\n");

    const result = parseWhatsAppExport({ ...BASE_INPUT, rawText });
    if (result.needsParticipantResolution) throw new Error("unreachable");

    // 3 participants — resolveParticipantRoles returns UNRESOLVED regardless
    // of the business-name match, since roleForSender requires exactly 2.
    expect(result.messages.every((m) => m.resolvedRole === "UNKNOWN")).toBe(true);
  });

  it("collects a warning per unparseable timestamp without dropping the message", () => {
    const rawText = "40/13/26, 14:05 - María López: Hola";
    const result = parseWhatsAppExport({ ...BASE_INPUT, knownBusinessNames: [], rawText });
    if (result.needsParticipantResolution) throw new Error("unreachable");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].occurredAt).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe("UNPARSEABLE_TIMESTAMP");
  });
});

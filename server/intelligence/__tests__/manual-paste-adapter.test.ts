import { describe, expect, it } from "vitest";
import { manualPasteChannelAdapter } from "../channel-adapters/manual-paste-adapter";

describe("manualPasteChannelAdapter", () => {
  it("has the 'manual' channel", () => {
    expect(manualPasteChannelAdapter.channel).toBe("manual");
  });

  it("normalizes each non-empty line into one message, defaulting to INBOUND", () => {
    const messages = manualPasteChannelAdapter.normalize("Hola, tengo una Hilux 2022\nOUT: Claro, cuéntame más\n\n");

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ direction: "INBOUND", content: "Hola, tengo una Hilux 2022" });
    expect(messages[1]).toMatchObject({ direction: "OUTBOUND", content: "Claro, cuéntame más" });
  });

  it("strips the OUT: prefix and is case-insensitive", () => {
    const messages = manualPasteChannelAdapter.normalize("out: precio del kit?");
    expect(messages[0]).toMatchObject({ direction: "OUTBOUND", content: "precio del kit?" });
  });

  it("preserves paste order via strictly increasing occurredAt", () => {
    const messages = manualPasteChannelAdapter.normalize("primero\nsegundo\ntercero");
    expect(messages[0].occurredAt.getTime()).toBeLessThan(messages[1].occurredAt.getTime());
    expect(messages[1].occurredAt.getTime()).toBeLessThan(messages[2].occurredAt.getTime());
  });

  it("drops blank lines", () => {
    const messages = manualPasteChannelAdapter.normalize("\n  \nhola\n\n");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hola");
  });
});

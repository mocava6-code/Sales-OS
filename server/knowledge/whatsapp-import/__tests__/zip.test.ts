import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractChatTextFromZip, InvalidWhatsAppZipError, ZipTooLargeError } from "../zip";

async function buildZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractChatTextFromZip", () => {
  it("extracts _chat.txt (iOS export naming)", async () => {
    const zip = await buildZip({ "_chat.txt": "27/07/26, 14:05 - María: Hola", "IMG-001.jpg": "not real image bytes" });

    const text = await extractChatTextFromZip(zip);

    expect(text).toBe("27/07/26, 14:05 - María: Hola");
  });

  it("falls back to any .txt member when _chat.txt isn't present (Android naming)", async () => {
    const zip = await buildZip({ "WhatsApp Chat with Juan Pérez.txt": "27/07/26, 14:05 - María: Hola" });

    const text = await extractChatTextFromZip(zip);

    expect(text).toBe("27/07/26, 14:05 - María: Hola");
  });

  it("never touches non-.txt members", async () => {
    const zip = await buildZip({ "_chat.txt": "hello", "video.mp4": "binary junk" });

    const text = await extractChatTextFromZip(zip);

    expect(text).toBe("hello");
  });

  it("rejects a zip with no .txt member", async () => {
    const zip = await buildZip({ "photo.jpg": "not text" });

    await expect(extractChatTextFromZip(zip)).rejects.toBeInstanceOf(InvalidWhatsAppZipError);
  });

  it("rejects a non-zip buffer", async () => {
    await expect(extractChatTextFromZip(Buffer.from("not a zip at all"))).rejects.toBeInstanceOf(InvalidWhatsAppZipError);
  });

  it("rejects a zip with more than the member-count limit", async () => {
    // The cap was raised from 20 to 500 (a real months-long sales
    // conversation with photos easily exceeds a couple dozen attachments —
    // confirmed a real production export hit the old cap and failed to
    // import) — this fixture exceeds the NEW limit, not the old one.
    const files: Record<string, string> = { "_chat.txt": "27/07/26, 14:05 - María: Hola" };
    for (let i = 0; i < 501; i++) files[`IMG-${i}.jpg`] = "x";
    const zip = await buildZip(files);

    await expect(extractChatTextFromZip(zip)).rejects.toBeInstanceOf(ZipTooLargeError);
  });

  it("accepts a zip with many media attachments, well under the raised limit", async () => {
    const files: Record<string, string> = { "_chat.txt": "27/07/26, 14:05 - María: Hola" };
    for (let i = 0; i < 100; i++) files[`IMG-${i}.jpg`] = "x";
    const zip = await buildZip(files);

    await expect(extractChatTextFromZip(zip)).resolves.toBe("27/07/26, 14:05 - María: Hola");
  });

  it("rejects when the decompressed chat text exceeds the size guard", async () => {
    const huge = "27/07/26, 14:05 - María: " + "x".repeat(51 * 1024 * 1024);
    const zip = await buildZip({ "_chat.txt": huge });

    await expect(extractChatTextFromZip(zip)).rejects.toBeInstanceOf(ZipTooLargeError);
  });
});

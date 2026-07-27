import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractRawTextFromUpload, UnsupportedUploadTypeError, UploadTooLargeError, type UploadedFileLike } from "../upload-adapter";

function fakeFile(name: string, content: string | Buffer): UploadedFileLike {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return {
    name,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  };
}

describe("extractRawTextFromUpload — .txt", () => {
  it("reads a .txt file verbatim as UTF-8", async () => {
    const result = await extractRawTextFromUpload(fakeFile("chat.txt", "27/07/26, 14:05 - María: Hola"));

    expect(result.rawText).toBe("27/07/26, 14:05 - María: Hola");
    expect(result.externalSource).toBe("WHATSAPP_TXT_EXPORT");
    expect(result.sourceConversationId).toBe("chat.txt");
  });

  it("is case-insensitive about the .TXT extension", async () => {
    const result = await extractRawTextFromUpload(fakeFile("Chat Export.TXT", "hola"));
    expect(result.externalSource).toBe("WHATSAPP_TXT_EXPORT");
  });

  it("computes a stable sha256 hash of the raw bytes", async () => {
    const a = await extractRawTextFromUpload(fakeFile("chat.txt", "same content"));
    const b = await extractRawTextFromUpload(fakeFile("chat.txt", "same content"));
    const c = await extractRawTextFromUpload(fakeFile("chat.txt", "different content"));

    expect(a.rawFileHash).toBe(b.rawFileHash);
    expect(a.rawFileHash).not.toBe(c.rawFileHash);
  });
});

describe("extractRawTextFromUpload — .zip", () => {
  it("extracts the chat text from a WhatsApp export zip", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", "27/07/26, 14:05 - María: Hola");
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    const result = await extractRawTextFromUpload(fakeFile("WhatsApp Chat.zip", zipBuffer));

    expect(result.rawText).toBe("27/07/26, 14:05 - María: Hola");
    expect(result.externalSource).toBe("WHATSAPP_ZIP_EXPORT");
  });
});

describe("extractRawTextFromUpload — validation", () => {
  it("rejects an unsupported file extension", async () => {
    await expect(extractRawTextFromUpload(fakeFile("photo.jpg", "not text"))).rejects.toBeInstanceOf(UnsupportedUploadTypeError);
  });

  it("rejects a file over the size limit", async () => {
    const huge = Buffer.alloc(21 * 1024 * 1024, "x");
    await expect(extractRawTextFromUpload(fakeFile("chat.txt", huge))).rejects.toBeInstanceOf(UploadTooLargeError);
  });
});

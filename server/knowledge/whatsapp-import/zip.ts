// Unwraps a WhatsApp "Export Chat" .zip into its raw chat text. Hardened
// against decompression bombs (Sprint 8 review, item 6) within what JSZip's
// PUBLIC API actually supports — it does not expose a pre-decompression
// uncompressed-size field (confirmed against node_modules/jszip/index.d.ts:
// that lives on a private `_data` property the library's own types comment
// says not to rely on). So the guard here is: (1) member count is checked
// from zip metadata alone, before decompressing anything; (2) only the one
// selected chat-text member is ever decompressed — never the whole
// archive — and its decompressed size is checked immediately after,
// bounding worst-case peak memory to a single file. The upload action
// (server/knowledge/whatsapp-import-actions.ts) additionally caps the
// uploaded (compressed) file size before this function ever runs.

import "server-only";

import JSZip from "jszip";

export class InvalidWhatsAppZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWhatsAppZipError";
  }
}

export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipTooLargeError";
  }
}

// A real months-long sales conversation with photos/voice notes easily
// exceeds a couple dozen attachments — confirmed a real production export
// hit this cap and failed to import. The genuine memory guard is
// MAX_CHAT_TEXT_BYTES below (only the chat transcript itself is ever
// decompressed, never the media members) — this count is a much cheaper,
// coarser backstop against a truly pathological archive, not the primary
// defense, so it can afford to be generous.
const MAX_MEMBER_COUNT = 500;
const MAX_CHAT_TEXT_BYTES = 50 * 1024 * 1024; // 50MB, decompressed

/**
 * Locates and returns the chat transcript inside a WhatsApp export zip: iOS
 * names it `_chat.txt`; Android names vary ("WhatsApp Chat with X.txt"
 * etc.), so the fallback is the first .txt member found — media files are
 * never decompressed or otherwise touched (media extraction is out of scope
 * for v1's text-only pipeline).
 */
export async function extractChatTextFromZip(zipBytes: Buffer | ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(zipBytes).catch(() => {
    throw new InvalidWhatsAppZipError("The uploaded file is not a valid zip archive.");
  });

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_MEMBER_COUNT) {
    throw new ZipTooLargeError(`Zip contains ${entries.length} files, exceeding the ${MAX_MEMBER_COUNT}-file limit.`);
  }

  const textEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".txt"));
  if (textEntries.length === 0) {
    throw new InvalidWhatsAppZipError("No .txt chat transcript found in the zip.");
  }
  const chatEntry = textEntries.find((entry) => entry.name.toLowerCase().endsWith("_chat.txt")) ?? textEntries[0];

  const text = await chatEntry.async("text");
  if (Buffer.byteLength(text, "utf8") > MAX_CHAT_TEXT_BYTES) {
    throw new ZipTooLargeError(`"${chatEntry.name}" decompresses to more than ${MAX_CHAT_TEXT_BYTES / (1024 * 1024)}MB.`);
  }
  return text;
}

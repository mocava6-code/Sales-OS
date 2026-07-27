// Turns a Next.js Server Action's uploaded File into raw chat text — the one
// place that knows about the .txt/.zip distinction at the transport layer.
// Duck-typed against File (name + arrayBuffer()) rather than importing the
// DOM File type, so this is testable with a plain object, no jsdom needed.

import "server-only";

import { createHash } from "node:crypto";
import { extractChatTextFromZip } from "./zip";

export interface UploadedFileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ExtractedUploadSource = "WHATSAPP_TXT_EXPORT" | "WHATSAPP_ZIP_EXPORT";

export interface ExtractedUpload {
  rawText: string;
  externalSource: ExtractedUploadSource;
  sourceConversationId: string;
  rawFileHash: string;
}

export class UploadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadTooLargeError";
  }
}

export class UnsupportedUploadTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedUploadTypeError";
  }
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — the raw uploaded file itself, before any zip extraction

export async function extractRawTextFromUpload(file: UploadedFileLike): Promise<ExtractedUpload> {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadTooLargeError(`Upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.`);
  }

  const rawFileHash = createHash("sha256").update(buffer).digest("hex");
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".zip")) {
    const rawText = await extractChatTextFromZip(buffer);
    return { rawText, externalSource: "WHATSAPP_ZIP_EXPORT", sourceConversationId: file.name, rawFileHash };
  }
  if (lowerName.endsWith(".txt")) {
    return { rawText: buffer.toString("utf8"), externalSource: "WHATSAPP_TXT_EXPORT", sourceConversationId: file.name, rawFileHash };
  }
  throw new UnsupportedUploadTypeError(`Unsupported file type: "${file.name}". Upload a WhatsApp .txt or .zip export.`);
}

// Structural guardrail: server/observer-console/** must stay Prisma-free and
// write-free, by construction, not just by convention. Every function here
// depends only on injected read-only repository *interfaces*
// (server/persistence/repositories.ts) — it never imports a concrete
// Prisma*Repository, PrismaTransactionRunner, TransactionRunner/
// KoriUnitOfWork (write-transaction concepts, irrelevant to reads), or
// Prisma Client itself. This test scans real source files rather than
// trusting code review to catch a future regression.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const OBSERVER_CONSOLE_DIR = join(__dirname, "..");

const FORBIDDEN_IMPORT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /db\/client/, reason: "the app's shared Prisma singleton" },
  { pattern: /db\/generated/, reason: "Prisma Client's generated types/enums" },
  { pattern: /@prisma\/client/, reason: "Prisma Client itself" },
  { pattern: /@prisma\/adapter-pg/, reason: "the Postgres driver adapter" },
  { pattern: /persistence\/prisma\//, reason: "a concrete Prisma*Repository or PrismaTransactionRunner implementation" },
  { pattern: /persistence\/unit-of-work/, reason: "TransactionRunner/KoriUnitOfWork — write-transaction concepts" },
];

const WRITE_METHOD_PATTERNS = [
  /\.create\s*\(/,
  /\.createMany\s*\(/,
  /\.update\s*\(/,
  /\.updateMany\s*\(/,
  /\.upsert\s*\(/,
  /\.delete\s*\(/,
  /\.deleteMany\s*\(/,
];

function listSourceFiles(): string[] {
  return readdirSync(OBSERVER_CONSOLE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => join(OBSERVER_CONSOLE_DIR, entry.name));
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRegex = /(?:from|import)\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importRegex)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe("server/observer-console read-only guardrail", () => {
  const files = listSourceFiles();

  it("found the expected non-test source files (sanity check the scan itself isn't vacuous)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s imports nothing Prisma-concrete or write-side", (filePath) => {
    const source = readFileSync(filePath, "utf-8");
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      for (const { pattern, reason } of FORBIDDEN_IMPORT_PATTERNS) {
        expect(
          pattern.test(specifier),
          `${filePath} imports "${specifier}", which looks like ${reason} — server/observer-console/** must depend only on injected read-only repository interfaces.`,
        ).toBe(false);
      }
    }
  });

  it.each(files)("%s calls no write methods (.create/.update/.delete/.upsert and their *Many forms)", (filePath) => {
    const source = readFileSync(filePath, "utf-8");

    for (const pattern of WRITE_METHOD_PATTERNS) {
      expect(pattern.test(source), `${filePath} matched ${pattern} — server/observer-console/** must be read-only.`).toBe(false);
    }
  });
});

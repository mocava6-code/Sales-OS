import { describe, expect, it } from "vitest";
import { jaccardSimilarity, normalizeKey } from "../subject-similarity";

describe("normalizeKey", () => {
  it("lowercases, strips accents, and collapses whitespace", () => {
    expect(normalizeKey("  Hilux   TRAVO  ")).toBe("hilux travo");
    expect(normalizeKey("María López")).toBe("maria lopez");
  });

  it("strips punctuation", () => {
    expect(normalizeKey("Envíos a provincia (Shalom)")).toBe("envios a provincia shalom");
  });
});

describe("jaccardSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(jaccardSimilarity("Hilux TRAVO", "Hilux TRAVO")).toBe(1);
  });

  it("is 1 for strings identical after normalization", () => {
    expect(jaccardSimilarity("Hilux TRAVO", "hilux travo")).toBe(1);
  });

  it("is 0 for completely disjoint strings", () => {
    expect(jaccardSimilarity("Hilux TRAVO", "envios provincia shalom")).toBe(0);
  });

  it("is partial for overlapping-but-different strings", () => {
    const score = jaccardSimilarity("El TRAVO sirve para Hilux Revo desde 2016", "Compatible con Hilux desde el año 2016");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 1 when both strings are empty after normalization", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
  });

  it("returns 0 when only one string is empty", () => {
    expect(jaccardSimilarity("Hilux", "")).toBe(0);
  });
});

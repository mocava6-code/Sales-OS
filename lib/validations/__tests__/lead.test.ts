import { describe, expect, it } from "vitest";
import { leadSchema } from "../lead";

describe("leadSchema — phone normalization (Kori Data Correctness Phase 1D)", () => {
  it("normalizes Peru national-format input to E.164", () => {
    const result = leadSchema.safeParse({ name: "Juan Pérez", phone: "933517901" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+51933517901");
  });

  it("normalizes an already-E.164 phone to itself", () => {
    const result = leadSchema.safeParse({ name: "Juan Pérez", phone: "+51933517901" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+51933517901");
  });

  it("rejects an invalid phone number with a safe, generic message", () => {
    const result = leadSchema.safeParse({ name: "Juan Pérez", phone: "123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.phone).toEqual(["Enter a valid phone number."]);
    }
  });

  it("rejects an empty phone", () => {
    const result = leadSchema.safeParse({ name: "Juan Pérez", phone: "" });
    expect(result.success).toBe(false);
  });

  it("still requires a non-empty name", () => {
    const result = leadSchema.safeParse({ name: "  ", phone: "933517901" });
    expect(result.success).toBe(false);
  });

  it("defaults priority to NORMAL", () => {
    const result = leadSchema.safeParse({ name: "Juan Pérez", phone: "933517901" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe("NORMAL");
  });
});

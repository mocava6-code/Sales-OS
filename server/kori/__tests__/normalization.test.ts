import { describe, expect, it } from "vitest";
import { normalizeCustomerTypeTerm, normalizeVehicleBrand, normalizeVehicleModel } from "../normalization";

describe("normalizeVehicleBrand", () => {
  it.each(["toyota", "Toyota", "TOYOTA", "  toyota  "])("normalizes %s to Toyota", (input) => {
    expect(normalizeVehicleBrand(input)).toBe("Toyota");
  });

  it.each(["ford", "Ford", "FORD"])("normalizes %s to Ford", (input) => {
    expect(normalizeVehicleBrand(input)).toBe("Ford");
  });

  it("passes unrecognized input through unchanged (trimmed) — never guessed", () => {
    expect(normalizeVehicleBrand("  Chevrolet  ")).toBe("Chevrolet");
  });
});

describe("normalizeVehicleModel", () => {
  it.each(["hilux", "Hilux", "HILUX"])("normalizes %s to Hilux", (input) => {
    expect(normalizeVehicleModel(input)).toBe("Hilux");
  });

  it.each(["ranger", "Ranger", "RANGER"])("normalizes %s to Ranger", (input) => {
    expect(normalizeVehicleModel(input)).toBe("Ranger");
  });

  it.each(["fortuner", "Fortuner"])("normalizes %s to Fortuner", (input) => {
    expect(normalizeVehicleModel(input)).toBe("Fortuner");
  });

  it("passes unrecognized input through unchanged", () => {
    expect(normalizeVehicleModel("Camión")).toBe("Camión");
  });
});

describe("normalizeCustomerTypeTerm", () => {
  it.each(["b2b", "B2B", "mayorista", "distribuidor", "taller"])("normalizes %s to WHOLESALE", (input) => {
    expect(normalizeCustomerTypeTerm(input)).toBe("WHOLESALE");
  });

  it.each(["b2c", "B2C", "cliente final", "particular"])("normalizes %s to RETAIL", (input) => {
    expect(normalizeCustomerTypeTerm(input)).toBe("RETAIL");
  });

  it("returns null for unrecognized terms — never a fuzzy guess", () => {
    expect(normalizeCustomerTypeTerm("empresa grande")).toBeNull();
  });
});

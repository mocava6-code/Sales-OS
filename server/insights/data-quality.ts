// Kori Commercial Intelligence V2 — Fase D. Measures how complete each
// business's own commercial-profile data is, so "Aprendizajes de Kori" can
// honestly say "I need more information about X" instead of silently
// producing a worse answer. Never fabricates a missing value — this module
// only counts nulls, it never guesses one.

import { prisma } from "@/server/db/client";
import type { CustomerTypeProfile } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { classifyCustomerType } from "@/server/services/customer-type-classification";
import type { LeadCommercialProfileProvenance } from "@/server/services/lead-commercial-profile-service";
import { INSIGHTS_FETCH_CAP } from "./constants";

export const DATA_QUALITY_FIELDS = ["customerType", "vehicleBrand", "productInterest"] as const;
export type DataQualityField = (typeof DATA_QUALITY_FIELDS)[number];

export interface DataQualityStat {
  field: DataQualityField;
  missingCount: number;
  totalCount: number;
  missingPercentage: number;
}

export interface LeadForDataQuality {
  commercialProfile: { customerType: string | null; vehicleBrand: string | null; productInterest: string | null } | null;
}

/** Deliberately all-time, not a rolling window — a customerType missing on a lead from six months ago is still missing today, the same way a completeness percentage should read. */
export function deriveDataQualityStats(leads: LeadForDataQuality[]): DataQualityStat[] {
  const totalCount = leads.length;

  return DATA_QUALITY_FIELDS.map((field) => {
    const missingCount = leads.filter((lead) => lead.commercialProfile === null || lead.commercialProfile[field] === null).length;
    return { field, missingCount, totalCount, missingPercentage: totalCount > 0 ? Math.round((missingCount / totalCount) * 100) : 0 };
  });
}

export async function getDataQualityStats(businessId: string, db: PrismaClientOrTransaction = prisma): Promise<DataQualityStat[]> {
  const leads = await db.lead.findMany({
    where: { businessId },
    select: { commercialProfile: { select: { customerType: true, vehicleBrand: true, productInterest: true } } },
    take: INSIGHTS_FETCH_CAP,
  });
  return deriveDataQualityStats(leads);
}

// --- customerType coverage (Confirmado / Inferido por Kori / Sin evidencia suficiente) ---

export interface CustomerTypeCoverage {
  totalCount: number;
  /** A literal statement — deterministic match or a confident-enough AI read of an explicit self-identification. See classifyCustomerType. */
  confirmedCount: number;
  /** AI contextual judgment, grounded but below the "explicit statement" confidence bar. */
  inferredRetailCount: number;
  inferredWholesaleCount: number;
  /** customerType is null — genuinely no evidence yet, not a system failure. */
  insufficientEvidenceCount: number;
}

export interface LeadForCustomerTypeCoverage {
  commercialProfile: { customerType: CustomerTypeProfile | null; provenance: unknown } | null;
}

export function deriveCustomerTypeCoverage(leads: LeadForCustomerTypeCoverage[]): CustomerTypeCoverage {
  const coverage: CustomerTypeCoverage = {
    totalCount: leads.length,
    confirmedCount: 0,
    inferredRetailCount: 0,
    inferredWholesaleCount: 0,
    insufficientEvidenceCount: 0,
  };

  for (const lead of leads) {
    const customerType = lead.commercialProfile?.customerType ?? null;
    const provenance = (lead.commercialProfile?.provenance as LeadCommercialProfileProvenance | null | undefined)?.customerType;
    const classification = classifyCustomerType(customerType, provenance);

    if (classification === "CONFIRMED") coverage.confirmedCount += 1;
    else if (classification === "INFERRED" && customerType === "WHOLESALE") coverage.inferredWholesaleCount += 1;
    else if (classification === "INFERRED" && customerType === "RETAIL") coverage.inferredRetailCount += 1;
    else coverage.insufficientEvidenceCount += 1;
  }

  return coverage;
}

export async function getCustomerTypeCoverage(businessId: string, db: PrismaClientOrTransaction = prisma): Promise<CustomerTypeCoverage> {
  const leads = await db.lead.findMany({
    where: { businessId },
    select: { commercialProfile: { select: { customerType: true, provenance: true } } },
    take: INSIGHTS_FETCH_CAP,
  });
  return deriveCustomerTypeCoverage(leads);
}

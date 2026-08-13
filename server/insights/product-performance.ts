// Unifies the two signals that today live in separate, misaligned
// pipelines (kori-briefing-service.ts's 7-day demand groups, conversion-
// intelligence-service.ts's calendar-month product conversion) into ONE
// per-product view: how much interest, and how much of it actually
// converts. Reuses deriveProductConversion (conversion-intelligence-
// service.ts) rather than re-deriving the closed/lost/decided math a
// second time — the "what counts as a decided outcome for a product" rule
// stays defined in exactly one place.

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { deriveProductConversion, type ProductConversion } from "@/server/services/conversion-intelligence-service";
import { INSIGHTS_FETCH_CAP, INSIGHTS_PERIOD_DAYS } from "./constants";

/** A product needs at least this many interested leads before demand is compared against the business average — one mention is noise, not a signal. */
const MIN_INTERESTED_FOR_CLASSIFICATION = 3;
/** Same reasoning as conversion-intelligence-service.ts's own MIN_DECIDED_FOR_PRODUCT_INSIGHT — a conversion rate off 1 decided outcome is not a rate. */
const MIN_DECIDED_FOR_CLASSIFICATION = 2;

export type ProductClassification = "ESTRELLA" | "OPORTUNIDAD_MEJORA" | "NICHO_RENTABLE";

export interface ProductPerformance {
  product: string;
  interested: number;
  interestedPreviousPeriod: number;
  /** Percentage change vs. the previous period — null when the previous period had zero interested leads (no baseline to compare against, not a 0% or infinite trend). */
  trendPercent: number | null;
  closed: number;
  lost: number;
  decided: number;
  conversionRate: number | null;
  /** null when there isn't enough demand or decided volume to classify honestly — most products, most of the time. */
  classification: ProductClassification | null;
}

export interface ProductPerformanceSummary {
  products: ProductPerformance[];
  periodDays: number;
}

/**
 * Combines this-period/previous-period interest counts with conversion
 * data into one row per product, then classifies each product relative to
 * the BUSINESS'S OWN averages (never a fixed global threshold — a small
 * business and a large one have very different "high demand" baselines).
 */
export function deriveProductPerformance(
  interestedThisPeriod: Map<string, number>,
  interestedPreviousPeriod: Map<string, number>,
  productConversion: ProductConversion[],
): ProductPerformance[] {
  const conversionByProduct = new Map(productConversion.map((p) => [p.product, p]));
  const allProducts = new Set([...interestedThisPeriod.keys(), ...conversionByProduct.keys()]);

  const rows: ProductPerformance[] = [...allProducts].map((product) => {
    const interested = interestedThisPeriod.get(product) ?? 0;
    const interestedPrev = interestedPreviousPeriod.get(product) ?? 0;
    const conversion = conversionByProduct.get(product);
    const decided = conversion?.decided ?? 0;
    return {
      product,
      interested,
      interestedPreviousPeriod: interestedPrev,
      trendPercent: interestedPrev > 0 ? Math.round(((interested - interestedPrev) / interestedPrev) * 100) : null,
      closed: conversion?.closed ?? 0,
      lost: conversion?.lost ?? 0,
      decided,
      conversionRate: conversion && decided > 0 ? conversion.conversionRate : null,
      classification: null,
    };
  });

  const eligibleForDemandAverage = rows.filter((r) => r.interested >= MIN_INTERESTED_FOR_CLASSIFICATION);
  const avgInterested = eligibleForDemandAverage.length > 0 ? eligibleForDemandAverage.reduce((sum, r) => sum + r.interested, 0) / eligibleForDemandAverage.length : 0;

  const eligibleForConversionAverage = rows.filter((r) => r.decided >= MIN_DECIDED_FOR_CLASSIFICATION && r.conversionRate !== null);
  const avgConversion =
    eligibleForConversionAverage.length > 0
      ? eligibleForConversionAverage.reduce((sum, r) => sum + (r.conversionRate ?? 0), 0) / eligibleForConversionAverage.length
      : null;

  for (const row of rows) {
    if (row.interested < MIN_INTERESTED_FOR_CLASSIFICATION) continue;
    if (row.decided < MIN_DECIDED_FOR_CLASSIFICATION || row.conversionRate === null || avgConversion === null) continue;

    const highDemand = row.interested >= avgInterested;
    const highConversion = row.conversionRate >= avgConversion;
    if (highDemand && highConversion) row.classification = "ESTRELLA";
    else if (highDemand && !highConversion) row.classification = "OPORTUNIDAD_MEJORA";
    else if (!highDemand && highConversion) row.classification = "NICHO_RENTABLE";
  }

  return rows.sort((a, b) => b.interested - a.interested);
}

async function fetchInterestCounts(
  businessId: string,
  periodStart: Date,
  previousPeriodStart: Date,
  now: Date,
  db: PrismaClientOrTransaction,
): Promise<{ thisPeriod: Map<string, number>; previousPeriod: Map<string, number> }> {
  const leads = await db.lead.findMany({
    where: { businessId, createdAt: { gte: previousPeriodStart, lte: now } },
    select: { createdAt: true, commercialProfile: { select: { productInterest: true } } },
    take: INSIGHTS_FETCH_CAP,
  });

  const thisPeriod = new Map<string, number>();
  const previousPeriod = new Map<string, number>();
  for (const lead of leads) {
    const product = lead.commercialProfile?.productInterest;
    if (!product) continue;
    const bucket = lead.createdAt >= periodStart ? thisPeriod : previousPeriod;
    bucket.set(product, (bucket.get(product) ?? 0) + 1);
  }
  return { thisPeriod, previousPeriod };
}

export async function getProductPerformance(businessId: string, now: Date = new Date(), db: PrismaClientOrTransaction = prisma): Promise<ProductPerformanceSummary> {
  const periodStart = new Date(now.getTime() - INSIGHTS_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const previousPeriodStart = new Date(periodStart.getTime() - INSIGHTS_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const [{ thisPeriod, previousPeriod }, decidedOutcomes] = await Promise.all([
    fetchInterestCounts(businessId, periodStart, previousPeriodStart, now, db),
    db.outcome.findMany({
      where: { businessId, outcomeType: { in: ["SALE_CLOSED", "SALE_LOST"] }, occurredAt: { gte: periodStart, lte: now } },
      select: {
        outcomeType: true,
        productSold: true,
        occurredAt: true,
        conversation: { select: { createdAt: true, lead: { select: { commercialProfile: { select: { productInterest: true } } } } } },
      },
    }),
  ]);

  const productConversion = deriveProductConversion(
    decidedOutcomes.map((o) => ({
      outcomeType: o.outcomeType as "SALE_CLOSED" | "SALE_LOST",
      productSold: o.productSold,
      occurredAt: o.occurredAt,
      conversationCreatedAt: o.conversation.createdAt,
      productInterest: o.conversation.lead.commercialProfile?.productInterest ?? null,
    })),
  );

  return { products: deriveProductPerformance(thisPeriod, previousPeriod, productConversion), periodDays: INSIGHTS_PERIOD_DAYS };
}

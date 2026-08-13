// Kori Business Insights Engine — the new "pattern recognition" layer on
// top of everything Sales OS already tracks (conversations, commercial
// profiles, semantic action states, outcomes). Deliberately separate from
// server/services/** (existing operational services) and server/kori/**
// (the single-dimension count/list/group query engine, which this layer
// never replaces) — its own module boundary for a genuinely new kind of
// question: not "what is happening" but "what does the pattern mean."
//
// Same philosophy as every insight this codebase has shipped so far
// (kori-briefing-service.ts's buildPulseSummary, conversion-intelligence-
// service.ts's buildConversionInsight): pure aggregation over real data,
// no AI, a fixed window, and a minimum-sample gate before any comparison
// is allowed to produce a sentence. A wrong insight is worse than no
// insight — every function in this layer is built around that rule.

/** Both "this period" and "the period before it" (for trend/week-over-week comparisons) use the same width. */
export const INSIGHTS_PERIOD_DAYS = 30;

/** Fetch-then-process-in-memory bound, same reasoning as server/kori/query-executor.ts's IN_MEMORY_PROCESSING_FETCH_CAP — correct and fast at pilot scale, not built for real scale yet. */
export const INSIGHTS_FETCH_CAP = 1000;

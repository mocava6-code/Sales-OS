// Deterministic HTML -> sections extraction. No LLM here — cheerio only.
//
// Segmentation preference order (Sprint 8 quality-fix review, item 1),
// each tier only ever applied to what the previous tier didn't already
// claim:
//   1. CARD      — an individual product card/item (<article>, [itemscope])
//   2. HEADING   — a heading (h1-h3) and the body directly under it, when
//                  that body is small enough to be one coherent unit
//   3. PARAGRAPH — when a heading's body is too large, each paragraph/list
//                  block under it becomes its own section instead
//   4. FALLBACK  — when a single block is STILL too large (no natural
//                  paragraph break), split by sentence boundaries into
//                  bounded chunks — never a mid-sentence truncation
//
// Every section is tagged `reliable` — false only for FALLBACK-tier
// sections. Deterministic candidate rules (server/knowledge/deterministic/**)
// refuse to fire on unreliable sections; this is the mechanism that keeps a
// weakly-structured page from producing a giant multi-product "grounded"
// statement blob. Classification (page-extraction's PageContext job) is
// still a best-effort heuristic, not a guarantee — the deterministic
// grounding backstop it feeds is what's actually authoritative.

import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { normalizeContent } from "@/server/intelligence/observation/detectors/keyword-detectors";

export type PageContext = "PRODUCT" | "SERVICE" | "FAQ" | "POLICY" | "MARKETING" | "TESTIMONIAL" | "UNKNOWN";
export type SectionTier = "CARD" | "HEADING" | "PARAGRAPH" | "FALLBACK";

const BOILERPLATE_SELECTORS = ["nav", "header", "footer", "script", "style", "noscript", "svg", "form", "[class*='cookie']", "[id*='cookie']"];
const CARD_SELECTOR = "article, [itemscope]";
const BLOCK_SELECTOR = "p, li, blockquote";

const MAX_RELIABLE_SECTION_LENGTH = 600;
const MAX_FALLBACK_CHUNK_LENGTH = 500;

const URL_PATH_HINTS: Array<[RegExp, PageContext]> = [
  [/\/(tienda|producto|productos|catalogo|kit)/i, "PRODUCT"],
  [/\/(servicio|servicios|instalacion)/i, "SERVICE"],
  [/\/(faq|preguntas)/i, "FAQ"],
  [/\/(politica|terminos|privacidad|garantia)/i, "POLICY"],
  [/\/(testimonio|testimonios|opiniones|resenas)/i, "TESTIMONIAL"],
  [/\/(nosotros|sobre|quienes-somos)/i, "MARKETING"],
];

// Checked against a section's HEADING text specifically (not body content) —
// widened (Sprint 8 quality-fix review, item 2 follow-up) beyond the literal
// word "testimonio" so a heading like "Lo que dicen nuestros clientes" is
// recognized without the customer quotes themselves needing to contain any
// particular keyword. This is one of three independent testimonial signals
// (see classifySection) — structural (blockquote tag) and lexical (quote
// marks wrapping the text) are the other two, so a review block is still
// caught even under a heading this pattern doesn't anticipate.
const TESTIMONIAL_HEADING_PATTERN =
  /testimonio|lo que (dicen|opinan|dice)|opini[oó]n(es)? de (nuestros )?clientes|rese[ñn]a|cliente(s)? satisfech|comentarios de (nuestros )?clientes/i;

// A heading matching this is a real FAQ section even if it's phrased as a
// question — checked before the generic "interrogative heading" rule below,
// so a genuine "¿Cuál es la garantía?" under an actual FAQ page isn't
// demoted to MARKETING by that broader heuristic.
const FAQ_HEADING_PATTERN = /pregunta(s)? frecuente|\bfaq\b/i;

const SECTION_KEYWORD_HINTS: Array<[RegExp, PageContext]> = [
  [/pol[ií]tica|garant[ií]a|t[eé]rminos|condiciones|privacidad/i, "POLICY"],
  [/env[ií]o|entrega|despacho|shalom|delivery|shipping/i, "SERVICE"],
  [/compatible|compatibilidad|hilux|fortuner|ranger|f-150|instalaci[oó]n/i, "PRODUCT"],
  [/el mejor|los mejores|oferta|promoci[oó]n|somos l[ií]deres|calidad garantizada/i, "MARKETING"],
];

function classifyText(text: string, hints: Array<[RegExp, PageContext]>): PageContext | null {
  for (const [pattern, context] of hints) {
    if (pattern.test(text)) return context;
  }
  return null;
}

/** A pull-quote wrapped in typographic quote marks — a strong structural signal of a testimonial regardless of wording. */
function isQuotedText(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  const opens = ["“", "«", '"', "'"];
  const closes = ["”", "»", '"', "'"];
  return opens.some((o) => t.startsWith(o)) && closes.some((c) => t.endsWith(c));
}

/** A heading phrased as a question ("¿Cómo funciona?", "¿Buscas piezas para tu Toyota o Ford?") is CTA/explainer copy, not a factual statement — generalizes beyond any specific wording. */
function isRhetoricalQuestionHeading(heading: string): boolean {
  return /\?\s*$/.test(heading.trim());
}

function classifySection(pageUrl: string, heading: string | null, text: string, isQuoteBlock: boolean): PageContext {
  // Structural/lexical testimonial signals win outright — a review block's
  // own content (which often legitimately mentions "compatible"/vehicle
  // names, since customers describe their own purchase) must never leak
  // into a PRODUCT/SERVICE classification via the keyword loop below.
  if (isQuoteBlock || isQuotedText(text) || (heading !== null && TESTIMONIAL_HEADING_PATTERN.test(heading))) return "TESTIMONIAL";

  if (heading !== null && FAQ_HEADING_PATTERN.test(heading)) return "FAQ";
  if (heading !== null && isRhetoricalQuestionHeading(heading)) return "MARKETING";

  const urlHint = classifyText(pageUrl, URL_PATH_HINTS);
  return classifyText(`${heading ?? ""} ${text}`, SECTION_KEYWORD_HINTS) ?? urlHint ?? "UNKNOWN";
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Generic UI/tab labels ("Descripción", "Especificaciones", ...) describe an
// ASPECT of whatever the page is about — they are never themselves a
// product's identity, so they must never outrank a real structural subject
// (Sprint 8 quality-fix review, item 1 follow-up). Normalized (lowercased,
// diacritics stripped) before matching.
const GENERIC_SECTION_LABELS = new Set([
  "descripcion",
  "caracteristicas",
  "caracteristica",
  "detalles",
  "detalle",
  "informacion",
  "especificaciones",
  "especificacion",
  "mas informacion",
  "informacion adicional",
]);

function isGenericSectionLabel(heading: string | null): boolean {
  if (!heading) return false;
  return GENERIC_SECTION_LABELS.has(normalizeContent(heading).trim());
}

/** Last-resort subject when a page has neither an H1 nor a <title> — humanizes the URL's final path segment ("faros-led-hilux-2016-2023" -> "Faros Led Hilux 2016 2023"). */
function humanizeSlug(pageUrl: string): string | null {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    return null;
  }
  const lastSegment = path.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  if (!lastSegment) return null;
  const words = lastSegment.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Joins a node's descendant text content the way a reader would, inserting a
 * separator at every element boundary regardless of whether the source HTML
 * itself had whitespace there. Cheerio's own `.text()` is a raw text-node
 * concatenation — adjacent inline elements with no literal whitespace between
 * them in the markup (e.g. a heading immediately followed by a `<span
 * class="badge">` with no space) collapse into one run-on word ("Aros y
 * RinesDESTACADO"). `cleanText`'s whitespace collapse makes always-inserting
 * a separator safe: a real space already in the source just becomes a
 * harmless double-space that collapses back to one.
 */
function spacedText($: CheerioAPI, node: Cheerio<Element>): string {
  const parts: string[] = [];
  node.contents().each((_, child) => {
    if (child.type === "text") {
      const data = (child as unknown as { data: string }).data;
      if (data.length > 0) parts.push(data);
    } else if (child.type === "tag") {
      const childText = spacedText($, $(child as Element));
      if (childText.length > 0) parts.push(childText);
    }
  });
  return parts.join(" ");
}

/** Splits an oversized single block into <= MAX_FALLBACK_CHUNK_LENGTH chunks at sentence boundaries — never mid-sentence. */
function splitIntoSentenceBoundedChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (trimmedSentence.length === 0) continue;
    const candidate = current.length > 0 ? `${current} ${trimmedSentence}` : trimmedSentence;
    if (candidate.length > MAX_FALLBACK_CHUNK_LENGTH && current.length > 0) {
      chunks.push(current);
      current = trimmedSentence;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.length > 0 ? chunks : [text];
}

export interface ExtractedSection {
  heading: string | null;
  subjectHint: string | null;
  text: string;
  context: PageContext;
  tier: SectionTier;
  reliable: boolean;
}

/**
 * Resolves the subject a rule should treat as this section's product/topic
 * identity (Sprint 8 quality-fix review, item 2 + follow-up). Priority:
 *   1. CARD tier's own title (a product card's heading/link/alt text) — the
 *      single most reliable signal there is, since a card only ever
 *      describes the one product it wraps.
 *   2. `pageIdentity` (the page's H1, else its <title>, else a slug-derived
 *      name) — a single-product detail page is about ONE thing throughout,
 *      so its H1 outranks a body sub-heading like "Descripción" or
 *      "Compatibilidad" describing one ASPECT of that one thing.
 *   3. The section's own local heading, but only when it isn't a generic
 *      UI/tab label ("Descripción", "Especificaciones", ...) — last resort,
 *      for the rare page with neither an H1 nor a usable <title>/slug.
 */
function resolveSubjectHint(tier: SectionTier, localHeading: string | null, pageIdentity: string | null): string | null {
  if (tier === "CARD") return localHeading ?? pageIdentity;
  if (pageIdentity) return pageIdentity;
  return isGenericSectionLabel(localHeading) ? null : localHeading;
}

function makeSection(
  pageUrl: string,
  heading: string | null,
  text: string,
  tier: SectionTier,
  pageIdentity: string | null,
  isQuoteBlock: boolean,
): ExtractedSection {
  const cleaned = cleanText(text);
  return {
    heading,
    subjectHint: resolveSubjectHint(tier, heading, pageIdentity),
    text: cleaned,
    context: classifySection(pageUrl, heading, cleaned, isQuoteBlock),
    tier,
    reliable: tier !== "FALLBACK" && cleaned.length <= MAX_RELIABLE_SECTION_LENGTH,
  };
}

/** Best available title for a product-card element: its own heading, else a link's visible text, else an image's alt text. */
function extractCardTitle($: CheerioAPI, $card: Cheerio<Element>): string | null {
  const heading = $card.find("h1, h2, h3, h4").first();
  const headingText = heading.length > 0 ? cleanText(spacedText($, heading)) : "";
  if (headingText.length > 0) return headingText;

  const linkText = $card
    .find("a")
    .toArray()
    .map((el) => cleanText(spacedText($, $(el))))
    .find((text) => text.length > 0);
  if (linkText) return linkText;

  const altText = $card.find("img[alt]").first().attr("alt")?.trim();
  return altText && altText.length > 0 ? altText : null;
}

function extractCardSections(pageUrl: string, $: CheerioAPI, cards: Cheerio<Element>, pageIdentity: string | null): ExtractedSection[] {
  const sections: ExtractedSection[] = [];

  cards.each((_, el) => {
    const $card = $(el);
    const text = cleanText(spacedText($, $card));
    if (text.length === 0) return;

    const title = extractCardTitle($, $card);
    const isQuoteBlock = $card.find("blockquote").length > 0;

    if (text.length <= MAX_RELIABLE_SECTION_LENGTH) {
      sections.push(makeSection(pageUrl, title, text, "CARD", pageIdentity, isQuoteBlock));
      return;
    }

    // A card whose own text is still oversized (unusual, but possible for a
    // very content-heavy product page wrapped in one [itemscope]) — split
    // its own blocks the same way an oversized heading-body would be.
    const blockTexts = $card
      .find(BLOCK_SELECTOR)
      .toArray()
      .map((blockEl) => cleanText(spacedText($, $(blockEl))))
      .filter((t) => t.length > 0);
    sections.push(
      ...splitBlocksUnderHeading(pageUrl, title, blockTexts.length > 0 ? blockTexts : [text], "CARD", pageIdentity, isQuoteBlock),
    );
  });

  return sections;
}

/** Given the block texts collected under one heading (or one oversized card), produces one HEADING section if small enough, else PARAGRAPH/FALLBACK sections. */
function splitBlocksUnderHeading(
  pageUrl: string,
  heading: string | null,
  blockTexts: string[],
  originTier: "CARD" | "HEADING",
  pageIdentity: string | null,
  isQuoteBlock: boolean,
): ExtractedSection[] {
  const joined = blockTexts.join(" ").trim();
  if (joined.length === 0) return [];

  if (joined.length <= MAX_RELIABLE_SECTION_LENGTH) {
    return [makeSection(pageUrl, heading, joined, originTier === "CARD" ? "CARD" : "HEADING", pageIdentity, isQuoteBlock)];
  }

  // Too large as one unit — fall back to one section per block.
  const sections: ExtractedSection[] = [];
  for (const blockText of blockTexts) {
    if (blockText.length <= MAX_RELIABLE_SECTION_LENGTH) {
      sections.push(makeSection(pageUrl, heading, blockText, "PARAGRAPH", pageIdentity, isQuoteBlock));
      continue;
    }
    // A single block is itself still too large — no natural break left
    // except sentence boundaries. Never truncated to "manufacture" a
    // smaller fact — every chunk together still covers the full text.
    for (const chunk of splitIntoSentenceBoundedChunks(blockText)) {
      sections.push(makeSection(pageUrl, heading, chunk, "FALLBACK", pageIdentity, isQuoteBlock));
    }
  }
  return sections;
}

function extractHeadingSections(pageUrl: string, $: CheerioAPI, root: Cheerio<Element>, pageIdentity: string | null): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let currentHeading: string | null = null;
  let currentBlocks: string[] = [];
  let currentHasQuoteBlock = false;

  function flush() {
    sections.push(...splitBlocksUnderHeading(pageUrl, currentHeading, currentBlocks, "HEADING", pageIdentity, currentHasQuoteBlock));
    currentBlocks = [];
    currentHasQuoteBlock = false;
  }

  root.find(`h1, h2, h3, ${BLOCK_SELECTOR}`).each((_, el) => {
    const node = $(el);
    const tag = el.tagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      flush();
      currentHeading = cleanText(spacedText($, node));
    } else {
      const text = cleanText(spacedText($, node));
      if (text.length > 0) {
        currentBlocks.push(text);
        if (tag === "blockquote") currentHasQuoteBlock = true;
      }
    }
  });
  flush();

  return sections;
}

export interface ExtractedPage {
  title: string | null;
  sections: ExtractedSection[];
  fullText: string;
  /** Majority vote across sections — WebsitePage.pageContext's page-wide dominant label, not authoritative for extraction (see file header). */
  dominantContext: PageContext;
  links: string[];
}

export function extractPageContent(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  for (const selector of BOILERPLATE_SELECTORS) $(selector).remove();

  const title = $("title").first().text().trim() || null;
  const body = $("main").length > 0 ? $("main") : $("body");

  // The page's own product/topic identity (Sprint 8 quality-fix review,
  // item 2 follow-up) — an H1 beats the raw <title> tag, which often
  // carries a " | Site Name" suffix. Computed before any removal, since an
  // H1 can structurally sit inside a card on some templates.
  const pageH1El = body.find("h1").first();
  const pageH1 = pageH1El.length > 0 ? cleanText(spacedText($, pageH1El)) : "";
  const pageIdentity: string | null = (pageH1.length > 0 ? pageH1 : null) ?? title ?? humanizeSlug(pageUrl);

  // Links collected before any removal, from the whole body — discovery
  // needs every same-domain href regardless of which segmentation tier
  // eventually claims the surrounding content.
  const links: string[] = [];
  body.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });

  // Tier 1 — product cards, removed afterward so tiers 2-4 never re-process
  // the same content.
  const cards = body.find(CARD_SELECTOR);
  const cardSections = extractCardSections(pageUrl, $, cards, pageIdentity);
  cards.remove();

  // Tiers 2-4 — whatever's left.
  const headingSections = extractHeadingSections(pageUrl, $, body, pageIdentity);

  const sections = [...cardSections, ...headingSections];
  const fullText = sections.map((s) => (s.heading ? `${s.heading}: ${s.text}` : s.text)).join("\n\n");

  const contextCounts = new Map<PageContext, number>();
  for (const section of sections) contextCounts.set(section.context, (contextCounts.get(section.context) ?? 0) + 1);
  let dominantContext: PageContext = "UNKNOWN";
  let dominantCount = 0;
  for (const [context, count] of contextCounts) {
    if (context !== "UNKNOWN" && count > dominantCount) {
      dominantContext = context;
      dominantCount = count;
    }
  }

  return { title, sections, fullText, dominantContext, links };
}

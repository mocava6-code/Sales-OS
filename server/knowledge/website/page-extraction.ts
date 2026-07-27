// Deterministic HTML -> sections extraction. No LLM here — cheerio only.
// Classification (page-extraction's job) is a best-effort heuristic, not a
// guarantee: it's a first pass that feeds ExtractionDocumentSection.context,
// which the extraction prompt (server/knowledge/prompts/kori-knowledge-extraction-prompt.ts)
// treats as authoritative for the MARKETING/TESTIMONIAL exclusion rule, and
// which extraction-grounding.ts enforces as a deterministic backstop
// regardless of what this heuristic gets wrong — see Sprint 8 review, item 8.

import * as cheerio from "cheerio";

export type PageContext = "PRODUCT" | "SERVICE" | "FAQ" | "POLICY" | "MARKETING" | "TESTIMONIAL" | "UNKNOWN";

const BOILERPLATE_SELECTORS = ["nav", "header", "footer", "script", "style", "noscript", "svg", "form", "[class*='cookie']", "[id*='cookie']"];

const URL_PATH_HINTS: Array<[RegExp, PageContext]> = [
  [/\/(tienda|producto|productos|catalogo|kit)/i, "PRODUCT"],
  [/\/(servicio|servicios|instalacion)/i, "SERVICE"],
  [/\/(faq|preguntas)/i, "FAQ"],
  [/\/(politica|terminos|privacidad|garantia)/i, "POLICY"],
  [/\/(testimonio|testimonios|opiniones|resenas)/i, "TESTIMONIAL"],
  [/\/(nosotros|sobre|quienes-somos)/i, "MARKETING"],
];

const SECTION_KEYWORD_HINTS: Array<[RegExp, PageContext]> = [
  [/testimonio|opini[oó]n|rese[ñn]a|cliente satisfecho/i, "TESTIMONIAL"],
  [/pregunta frecuente|\bfaq\b|preguntas frecuentes/i, "FAQ"],
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

export interface ExtractedSection {
  heading: string | null;
  text: string;
  context: PageContext;
}

export interface ExtractedPage {
  title: string | null;
  sections: ExtractedSection[];
  fullText: string;
  /** Majority vote across sections — WebsitePage.pageContext's page-wide dominant label, not authoritative for extraction (see file header). */
  dominantContext: PageContext;
  links: string[];
}

/**
 * Splits body text into sections at h1-h3 boundaries — each heading plus the
 * text up to the next heading is one section. Content before the first
 * heading (if any) becomes a heading-less leading section.
 */
export function extractPageContent(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  for (const selector of BOILERPLATE_SELECTORS) $(selector).remove();

  const title = $("title").first().text().trim() || null;
  const body = $("main").length > 0 ? $("main") : $("body");

  const sections: ExtractedSection[] = [];
  let currentHeading: string | null = null;
  let currentText: string[] = [];

  function flush() {
    const text = currentText.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      const urlHint = classifyText(pageUrl, URL_PATH_HINTS);
      const context = classifyText(`${currentHeading ?? ""} ${text}`, SECTION_KEYWORD_HINTS) ?? urlHint ?? "UNKNOWN";
      sections.push({ heading: currentHeading, text, context });
    }
    currentText = [];
  }

  body.find("h1, h2, h3, p, li, blockquote").each((_, el) => {
    const node = $(el);
    const tag = el.tagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      flush();
      currentHeading = node.text().trim();
    } else {
      const text = node.text().trim();
      if (text.length > 0) currentText.push(text);
    }
  });
  flush();

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

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });

  return { title, sections, fullText, dominantContext, links };
}

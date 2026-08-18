import { prisma } from "../../db/client";
import type { KnowledgeCategory } from "../../db/generated/client";
import { normalizeContent } from "../../intelligence/observation/detectors/keyword-detectors";
import type { KnowledgeSnippet, KnowledgeSnippetKind, KnowledgeSource } from "../../intelligence/knowledge-source";
import type { PrismaClientOrTransaction } from "./client";

/**
 * The first real implementation of the KnowledgeSource seam
 * (server/intelligence/knowledge-source.ts) — that file's own doc comment
 * says the knowledge base "is designed separately after the engine
 * foundation is working; this interface is the seam it will plug into."
 * Knowledge Ingestion v1 (server/knowledge/**) is that base: this class is
 * only the retrieval side, reading exclusively OWNER-approved, ACTIVE
 * KnowledgeItem rows — never a KnowledgeCandidate, which hasn't cleared
 * human review yet.
 *
 * Deliberately no embeddings/fuzzy search (matches this interface's own
 * "no implementation, no database, no embeddings... for this phase" —
 * still true; this is a explicit-lookup retrieval, same discipline as
 * freetext-product-extractor.ts). A KnowledgeItem's `tags` and `title` are
 * the curated "what this is about" signal — `content` itself is deliberately
 * NOT scored against, since a long paragraph of common words would produce
 * false-relevance matches. A snippet is only returned when at least one
 * tag/title token actually appears in the conversation text — an honest "no
 * relevant knowledge" (empty array) is always preferred over a guessed one.
 */
const CATEGORY_TO_KIND: Record<KnowledgeCategory, KnowledgeSnippetKind> = {
  PRODUCT: "catalog",
  COMPATIBILITY: "compatibility",
  // An objection-handling item is guidance on what to say, same family as a
  // recommended response — both map to "playbook", the closest kind this
  // interface defines for "how to handle this situation" knowledge.
  OBJECTION: "playbook",
  COMMERCIAL_POLICY: "policy",
  // A promotion's substance is a commercial term (validity, conditions),
  // not a literal price figure — closer to "policy" than "pricing".
  PROMOTION: "policy",
  FAQ: "playbook",
  RECOMMENDED_RESPONSE: "playbook",
  LOGISTICS: "shipping",
  PRICING: "pricing",
};

const KIND_TO_CATEGORIES: Record<KnowledgeSnippetKind, KnowledgeCategory[]> = {
  catalog: ["PRODUCT"],
  compatibility: ["COMPATIBILITY"],
  pricing: ["PRICING"],
  policy: ["COMMERCIAL_POLICY", "PROMOTION"],
  shipping: ["LOGISTICS"],
  playbook: ["OBJECTION", "FAQ", "RECOMMENDED_RESPONSE"],
  // No KnowledgeCategory models a single customer's own history today —
  // this kind has no backing category yet, so it can never match; listed
  // explicitly (not omitted) so a future category addition has an obvious
  // place to register itself.
  customer_history: [],
};

/** Tokens shorter than this are almost always noise ("de", "el", "un") rather than a real signal. */
const MIN_TOKEN_LENGTH = 3;
const MAX_SNIPPETS = 5;

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeContent(text)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH),
  );
}

function scoreItem(itemTokens: Set<string>, queryTokens: Set<string>): number {
  let score = 0;
  for (const token of itemTokens) {
    if (queryTokens.has(token)) score++;
  }
  return score;
}

export class PrismaKnowledgeSource implements KnowledgeSource {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async search(query: string, tenantId: string, kinds?: KnowledgeSnippetKind[]): Promise<KnowledgeSnippet[]> {
    const categories = kinds?.flatMap((kind) => KIND_TO_CATEGORIES[kind]);
    // An explicit `kinds` filter that maps to zero real categories (today,
    // only "customer_history") must return nothing — never silently ignore
    // the filter and search every category instead.
    if (kinds && categories && categories.length === 0) return [];

    const now = new Date();
    const rows = await this.db.knowledgeItem.findMany({
      where: {
        businessId: tenantId,
        status: "ACTIVE",
        ...(categories ? { category: { in: categories } } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, title: true, content: true, category: true, tags: true, updatedAt: true },
    });

    const queryTokens = tokenize(query);

    const scored = rows
      .map((row) => {
        const itemTokens = tokenize([row.title, ...row.tags].join(" "));
        return { row, score: scoreItem(itemTokens, queryTokens) };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.row.updatedAt.getTime() - a.row.updatedAt.getTime())
      .slice(0, MAX_SNIPPETS);

    return scored.map(({ row }) => ({
      id: row.id,
      kind: CATEGORY_TO_KIND[row.category],
      content: `${row.title}\n${row.content}`,
    }));
  }
}

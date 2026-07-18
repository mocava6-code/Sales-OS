// Interface only for this phase — no implementation, no database, no
// embeddings. The Koriaki knowledge base (catalog, compatibility, pricing,
// policy, shipping, playbooks, customer history) is designed separately
// after the engine foundation is working; this interface is the seam it
// will plug into.

export type KnowledgeSnippetKind =
  | "catalog"
  | "compatibility"
  | "pricing"
  | "policy"
  | "shipping"
  | "playbook"
  | "customer_history";

export interface KnowledgeSnippet {
  id: string;
  kind: KnowledgeSnippetKind;
  content: string;
}

export interface KnowledgeSource {
  search(query: string, tenantId: string, kinds?: KnowledgeSnippetKind[]): Promise<KnowledgeSnippet[]>;
}

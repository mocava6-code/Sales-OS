# Sales OS — Technical Architecture Proposal

## Guiding principle

> "Help average salespeople sell with the knowledge, discipline and follow-up ability of the business owner."

This is **not a CRM**. This product is a **daily companion**: it tells the salesperson who to
follow up with today, gives them the owner's product knowledge in seconds, and starts each day by
telling them what happened and what to do about it — grounded in real activity, not generic
advice.

Home screen mental model: **a morning briefing, a to-do list of follow-ups, and a search bar for
knowledge.** Not a dashboard, not a pipeline board, not a report.

---

## Product Principles

These principles are part of the product definition and should guide every future technical
decision.

- Every screen should answer one question: "What should I do next?"
- The product must reduce thinking, not increase it.
- AI is an analyst, never an autonomous actor.
- Every AI insight must be grounded in stored evidence.
- Manual data entry should be minimized whenever possible.
- Mobile-first over desktop-first.
- Speed over flexibility.
- Simplicity over configurability.
- Every feature must support the core mission: "Help average salespeople sell with the knowledge,
  discipline and follow-up ability of the business owner."
- If a feature does not strengthen follow-up discipline, knowledge access, or daily guidance, it
  should probably not exist.

---

## 1. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router, already scaffolded) | Keep as requested; RSC lets us ship a fast, mostly-server-rendered app with minimal client JS — important on mid-range Android and patchy LatAm mobile networks |
| Language | TypeScript | Safety at low cost, already scaffolded |
| Styling | Tailwind + shadcn/ui | Fast to build accessible, consistent mobile-first UI without a design team |
| Database | PostgreSQL (Supabase or Neon) | Relational fits the domain (leads, follow-ups, users) cleanly; Supabase bundles DB + Auth + Storage, which minimizes vendor sprawl for a small team |
| ORM | Prisma | Best DX/migration story for a small team moving fast; Drizzle is a fine alternative if edge latency becomes a concern later |
| Auth | Email magic link (Supabase Auth) | See §5 |
| AI / summarization | Single LLM provider, called server-side only (e.g. Claude) | Summarizes pasted conversations, extracts objections, drafts the daily insight — read/analyze only, no send capability anywhere |
| Hosting | Vercel | Native Next.js fit, generous free tier, fast iteration |
| Notifications | Web Push (PWA) | Mobile-first "discipline" nudges without needing an app store or WhatsApp API costs on day one |
| Delivery format | Installable PWA | LatAm sales reps are mobile-heavy and often data/storage-conscious; a PWA avoids app store friction and native app cost while still installing to the home screen |
| Client data layer | TanStack Query (mutations only) | Optimistic UI for "mark follow-up done" style actions; RSC handles the initial reads |
| Forms | react-hook-form + Zod | Minimal, fast, type-safe validation for the few forms we need |

**Explicitly not choosing (for now):** a separate backend service, GraphQL, Redux/heavy client
state, native mobile, a WhatsApp API integration.

---

## 2. Folder structure

Domain-first, not type-first — a change to "follow-ups" should touch one folder, not five.

```
sales-os/
  app/
    (auth)/
      login/
    (app)/                     # authenticated shell
      layout.tsx               # bottom nav, mobile shell
      page.tsx                 # "Today" — the morning briefing (see §3)
      leads/
        page.tsx
        [id]/page.tsx
      conversations/
        [id]/page.tsx          # view/paste/log a conversation for a lead
      knowledge/
        page.tsx
        [id]/page.tsx
      settings/
        page.tsx
    api/
      webhooks/                # future: WhatsApp, push
    layout.tsx
  components/
    ui/                        # shadcn primitives, unmodified
    leads/
    follow-ups/
    conversations/
    knowledge/
    today/                     # ActionsList, StartFlow, DailyInsightCard
    shared/                    # app shell, nav, empty states
  server/
    actions/                   # server actions, one file per domain
      leads.ts
      follow-ups.ts
      conversations.ts
      knowledge.ts
      insights.ts               # trigger/read daily insight generation
    services/                  # business logic, framework-agnostic
      lead-service.ts
      follow-up-service.ts
      conversation-service.ts
      knowledge-service.ts
      insight-service.ts       # all LLM calls live here only
    db/
      client.ts
      schema.prisma
  lib/
    auth/
    validations/                # Zod schemas shared client/server
    utils/
  types/
  docs/
    ARCHITECTURE.md
  public/
```

Key rule: **`server/services` contains all business logic and has no Next.js imports.** Route
handlers and server actions are thin wrappers. This is what makes §7 (future scalability) cheap
later — the logic isn't welded to the framework.

---

## 3. Component architecture

### The "Today" screen

Three sections, in order:

1. **Actions requiring attention** — three derived lists, no new persisted state:
   - *Unanswered customers*: `Conversation`s whose last entry is inbound and not yet closed
   - *Overdue follow-ups*: `FollowUp`s with `due_at` in the past and `status = pending`
   - *High-priority opportunities*: `Lead`s flagged `priority = high` and not won/lost

2. **Guided "Start" flow** — a client-side `StartFlow` component that walks through the items in
   section 1 one at a time. Deliberately **not** a new persisted entity or workflow engine — it's
   UI orchestration over `Conversation`, `FollowUp`, and `Lead`, which already carry the state
   needed to compute "what's next."

3. **"What we learned yesterday"** — one or more `DailyInsightCard`s, each rendering
   Observation / Recommendation / Suggested action with a link to the source `Conversation`(s) via
   `InsightEvidence`. If none exists yet for today, this section triggers on-demand generation
   (§7) rather than showing an empty state.

### General rules

- **Server Components by default.** Client Components only where there's real interactivity:
  the StartFlow, the conversation paste box, the knowledge search box, forms.
- **Mobile-first navigation:** bottom tab bar (Today / Leads / Knowledge / Settings), not a
  sidebar — matches the mental model of the apps this audience already uses daily.
- **Domain components, not generic ones.** `FollowUpCard`, `LeadRow`, `KnowledgeSnippet`,
  `DailyInsightCard` — built on shadcn primitives, not a generic `<Card>` reused everywhere with
  prop soup.
- **Optimistic actions everywhere that matters.** "Done", "Snooze", "Log a conversation" must
  feel instant — this is a habit-forming daily tool, latency kills adoption.
- **No modals-as-default.** On mobile, prefer full-screen sheets/routes over dialogs for primary
  flows (adding a lead, logging a conversation); reserve modals for quick confirmations.

---

## 4. Database design

Multi-tenant from day one via `business_id` on every table, even though the MVP UI will assume
one business per account. Retrofitting multi-tenancy later is far more expensive than including
it now.

```
Business
  id, name, owner_user_id, created_at

User
  id, business_id, name, email, role (owner | salesperson), created_at

Lead
  id, business_id, name, phone, status (new | contacted | follow_up | won | lost),
  priority (normal | high), assigned_to_user_id, last_contact_at, created_at

Conversation
  id, business_id, lead_id, channel (whatsapp | call | in_person | other),
  source (manual_paste | manual_entry),
  status (needs_reply | waiting_on_customer | closed),
  last_entry_at, last_entry_direction (inbound | outbound),
  ai_summary (nullable text), created_by_user_id, created_at, updated_at

ConversationEntry
  id, conversation_id, direction (inbound | outbound), content, occurred_at, created_at
  -- a pasted WhatsApp export is parsed into a handful of these; a quick manual log
  -- is one or two entries. No message-level sync, no read receipts, no media.

FollowUp
  id, lead_id, user_id, due_at, status (pending | done | snoozed), note, created_at

KnowledgeItem
  id, business_id, title, content,
  category (product | compatibility | objection | commercial_policy | promotion | faq |
            recommended_response | logistics),
  tags[], created_by_user_id, created_at, updated_at

DailyInsight
  id, business_id, user_id, insight_date,
  observation, recommendation, suggested_action, created_at
  -- multiple rows per salesperson per day are allowed

InsightEvidence
  id, daily_insight_id, conversation_id, excerpt (nullable text), created_at
```

Notes:
- `Conversation` + `ConversationEntry` fully replace the earlier "Interaction" concept — there is
  no separate interaction log table. This is expressive enough for "unanswered customer" detection
  and AI summarization without building a WhatsApp inbox.
- `KnowledgeItem` intentionally has no rigid `Product` table; `category = product` on free text
  covers it for v1.
- **Grounding guardrail:** the insight-generation service must refuse to persist a `DailyInsight`
  with zero `InsightEvidence` rows — structural enforcement, not just a prompt instruction.
- **Forward-compatibility:** WhatsApp API integration, when it lands, becomes a new
  `Conversation.source` value (`whatsapp_synced`) feeding the same `ConversationEntry` table — no
  reshape needed.
- Enforce `business_id` scoping at the query layer (Prisma middleware or a repository pattern in
  `server/services`) so it's structurally impossible for a service call to leak cross-tenant, even
  before Postgres RLS is added.

---

## 5. Suggested authentication

**Email magic link for the internal Koriaki pilot.**

| Method | Implementation simplicity | Initial operating cost | Fit for this pilot |
|---|---|---|---|
| **Email magic link (recommended)** | Built into Supabase Auth; no password-reset flow to build | $0 marginal cost | Strong — a small, known internal group that checks email reliably |
| Email/password | Similarly simple | $0 marginal cost | Fine, but adds password-reset UX for no benefit right now |
| Phone/OTP | Requires an SMS provider, per-country deliverability tuning | Real, recurring per-message cost from message one | Weak *right now* — its payoff (matching a phone-first external salesperson's identity) doesn't apply to an internal pilot |

Phone/OTP is not rejected outright — it's the right choice once the product moves from the
internal Koriaki pilot to real external SMB salespeople, where WhatsApp/phone genuinely is their
identity. It is deferred, not discarded (§10).

Two roles only: `owner`, `salesperson`. No granular permission system in MVP — the owner sees and
edits everything for their business; salespeople see their own leads/follow-ups and the shared
knowledge base.

---

## 6. State management

- **Server state is the default.** Reads happen in Server Components straight from the DB — no
  client cache to keep in sync for the common case.
- **TanStack Query for mutations that need optimism**: completing a follow-up, logging a
  conversation, searching knowledge. Small surface area, not a global store.
- **Zustand only if a genuine cross-cutting client concern appears** (e.g., an active filter that
  must survive navigation). Avoid introducing it preemptively.
- **No Redux.** The domain is too small to justify it, and it would slow down the "extremely
  simple" mandate.

---

## 7. Future scalability

- **WhatsApp integration path:** MVP logs conversations manually → v2 explores WhatsApp Business
  API webhooks or a browser-extension bridge for WhatsApp Web, populating the same
  `ConversationEntry` table (§4). Deliberately deferred — see §10.
- **AI layer:** already in MVP as read/analyze/suggest only (§9). The natural next step *after*
  the pilot — not in this MVP — is using the same summarization pipeline to draft (never send) a
  suggested reply for the salesperson to copy into WhatsApp manually.
- **Insight generation execution model:** start with on-demand generation (triggered when the
  Today screen loads and no `DailyInsight` exists for the current date) — no cron infrastructure
  needed for the pilot. Move to a nightly Vercel Cron job only once usage patterns justify
  pre-computing it.
- **Background jobs generally:** follow-up due-date scanning and push-notification dispatch start
  as a Vercel Cron hitting a service function; move to a real queue (Inngest/Trigger.dev) only
  when volume or reliability requirements demand it.
- **Service layer isolation** (§2) means business logic can be extracted from Next.js into a
  separate service later without a rewrite, if scale ever requires it.
- **DB scaling:** Postgres + a connection pooler (Supabase's built-in pooler or PgBouncer) covers
  a very long runway; read replicas are a "nice problem to have," not a v1 concern.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| WhatsApp Business API cost/approval complexity | Not in MVP; manual paste/log first |
| AI insight is generic or hallucinated, undermining trust | Structural grounding guardrail (§4): no insight without linked evidence |
| Salespeople don't paste/log conversations reliably, so there's nothing to summarize | Fast paste-and-go logging; the Start flow prompts logging as part of the daily habit |
| Salespeople abandon the app if it adds friction | Optimistic UI, one-tap actions, push reminders instead of relying on them to open the app |
| Owner never populates the knowledge base → the "knowledge" pillar is empty | Make adding a knowledge item trivially fast (short free-text, no rigid fields); consider voice-note-to-text capture in a later version |
| Data privacy (pasted personal conversations, phone numbers) across Brazil/LGPD and other LatAm regimes | Design `business_id` scoping and data export/delete paths early, even if not user-facing in MVP |
| Multi-tenant data leakage | Enforce tenant scoping at the service layer, not just in UI queries; add Postgres RLS once patterns stabilize |
| Over-trusting AI suggestions as directives rather than suggestions | AI output framed as "observation + suggestion" everywhere in UI copy and this architecture; no auto-actioning |
| Patchy mobile connectivity | PWA with basic offline caching of "today's follow-ups" is a natural v1.1, not v1 |
| Scope creep back into "just another CRM" | Every proposed feature should be checked against the mission statement before it's built (see §10) |

---

## 9. MVP scope

1. Auth: email magic link, one business per account
2. **Leads**: create/view, WhatsApp number, status, priority flag, assigned salesperson
3. **Conversations**: paste WhatsApp text (parsed into entries) or log manually; AI generates a
   short summary and flags objections
4. **Follow-ups**: due date/note on a lead; push notification + appear in Today's overdue list
5. **Knowledge base**: owner writes categorized free-text entries (the 8 categories in §4);
   salespeople search/browse
6. **"Today" screen**: Actions requiring attention, guided Start flow, "What we learned
   yesterday" with linked evidence
7. **Daily insight generation**: on-demand, server-side, grounded in stored conversations, never
   autonomous action
8. Installable PWA, mobile-first, bottom nav

That's the entire v1. Everything else waits.

---

## 10. Features that should NOT be built yet

- Full WhatsApp Business API integration (auto-synced message threads)
- Multi-channel inbox (email, Instagram, etc.)
- **AI autonomously sending or replying to a customer, in any form** — a hard boundary, not a
  sequencing decision; there is no send path in this architecture at all
- Deal/pipeline Kanban, sales stages beyond the simple lead status enum
- A structured/complex product catalog — `KnowledgeItem` with `category = product` covers v1
- Reporting/analytics dashboards, forecasting
- Team leaderboards/gamification
- Scheduled/cron-based insight generation (on-demand is enough for the pilot, §7)
- Native iOS/Android apps
- Custom fields / configurable CRM-style flexibility
- Third-party integrations marketplace (Zapier, etc.)
- Multi-plan billing/subscription infrastructure
- Phone/OTP auth (revisit once piloting with external salespeople, §5)

Each of these is a legitimate future feature — none of them earns its complexity before the core
loop (follow-up discipline + knowledge access + grounded daily insight) is proven with real
salespeople.

---

**Status of this proposal (§1–§10): superseded in part.** The sections above are the original
pre-implementation MVP proposal and are kept as historical record of the pilot's initial thinking.
Two items called out as explicitly deferred have since been built — WhatsApp Business API
integration (§10) and the beginning of the AI layer's decision-making half (§7 only anticipated
summarization; a full Decision Engine now exists) — see Part II below for what actually shipped
and how it relates back to this proposal. Everything else in §1–§10 (the "Today" screen, PWA
delivery, push notifications, the Learning Engine implied by "what we learned yesterday") remains
proposal-only and unbuilt.

---

# Part II — Kori: Commercial Intelligence Platform

Everything in this part was built after the proposal above, across five phases. It sits alongside
the original CRM-lite scaffold (§1–§10) rather than replacing it: `Lead`, `Conversation`,
`FollowUp`, `KnowledgeItem` are unchanged and still the system of record for day-to-day advisor
work. Kori is a set of layers that read and write around that same data, never a parallel app.

**Reading order matters here — each layer only knows about the one below it:**

```
server/whatsapp/          Meta-specific — the first inbound channel
        ↓ calls
server/orchestration/     coordinates engines + persistence, owns transactions
        ↓ calls                              ↓ calls
server/intelligence/       server/persistence/
   (Conversation            (Kori's memory —
    Intelligence Engine +    Prisma lives only
    Decision Engine —        here)
    Prisma-free)

server/application/       the only layer allowed to know about auth, HTTP,
                           and the browser — composition root + server actions
```

The one rule every phase enforced: **engines never import Prisma, and Prisma never leaks above
the persistence layer's repository interfaces.** `server/intelligence/**` has zero references to
`server/persistence/**` or `server/orchestration/**`; you can read it top to bottom without ever
learning this is a Next.js app.

---

## 11. The AI engines (`server/intelligence/`)

Pre-existing foundation for everything below — summarized here because Part II's later sections
assume it. Two engines, each with its own public entry point, error hierarchy, and Zod-validated
runtime schema mirroring its TypeScript types:

- **Conversation Intelligence Engine** (`analyze-conversation.ts` → `pipeline.ts`) — takes raw or
  pre-normalized channel messages (`ConversationIntelligenceInput`), returns
  `ConversationIntelligenceResult`: verified `Fact<T>`s, hypothesized `Inference<T>`s (never
  conflated — the `kind: "fact" | "inference"` discriminant is structural, not a naming
  convention), objections, missing information, and grounding warnings. A vendor-agnostic
  `AIProvider` interface (`ai-provider.ts`, `provider-factory.ts`, `providers/anthropic-ai-provider.ts`)
  means swapping or adding a model provider never touches the engine itself.
- **Decision Engine** (`decision/make-decisions.ts` → `decision/pipeline.ts`) — consumes a
  `KoriDecisionContext` (built from the Conversation Intelligence result plus known facts/business
  rules/prior interactions) and proposes one or more `KoriDecision`s: a type
  (`RESPOND_TO_CUSTOMER`, `ESCALATE_TO_HUMAN`, `FOLLOW_UP`, ...), reasoning, evidence, confidence,
  and a `riskLevel`/`impactLevel`/`approvalRequirement` computed deterministically by
  `risk-evaluator.ts`/`policy-evaluator.ts` — never left to the model to self-assess.

Both engines are pure: no Prisma import anywhere in `server/intelligence/`, dependencies (an
`AIProvider`) always passed in. This is what makes them testable with a mocked provider
(`testing/mock-ai-provider.ts`) and reusable from three different callers (orchestration, the
sample-analysis script, and — via orchestration — the WhatsApp gateway) without modification.

---

## 12. Kori's memory (`server/persistence/`)

Persists every commercial decision, its context, and its eventual outcome, so a future Learning
Engine can be built entirely from stored evidence — no Learning Engine exists yet; this phase only
built the ledger it will eventually read.

**Design rule:** repositories are thin (no business logic) and are the *only* code in the whole
Kori stack allowed to import Prisma. Each repository has a matching interface in
`repositories.ts` (Prisma-free) and a `Prisma*Repository` implementation in `prisma/` — every
implementation's constructor accepts a `PrismaClientOrTransaction`, defaulting to the app's shared
singleton, which is what lets `server/orchestration/` bind them to one atomic transaction (§13)
and lets tests bind them to an isolated database instead.

**New tables** (all additive to the schema in §4; `Lead`/`Conversation` are untouched):

| Table | Purpose |
|---|---|
| `ConversationSnapshot` | One row per Conversation Intelligence Engine run — verbatim, append-only. Re-analyzing a conversation never overwrites the last run; it adds a new one. |
| `DecisionRecord` | One row per `KoriDecision` ever proposed. Immutable except `status` (a denormalized fast-query field — `DecisionEvent` is the real source of truth for history). Carries `engineSchemaVersion`/`promptVersion`/`aiProvider`/`modelName` so a historical decision is always reproducible. |
| `DecisionEvent` | Append-only chronological log of every status transition (`PROPOSED`, `APPROVED`, `REJECTED`, `EXECUTED`, `ADVISOR_OVERRIDDEN`, `CUSTOMER_REPLIED`, `SALE_CLOSED`, `SALE_LOST`, ...). Never aggregated in place. |
| `AdvisorAction` | What the human actually did in response to a decision (followed it, ignored it, did something custom) — separate from `DecisionEvent` because it carries richer intent, not just a status change. |
| `Outcome` | The commercial result that followed a decision (customer replied, quotation sent, sale closed/lost, abandoned), with an `attribution` (`KORI_RECOMMENDATION` / `ADVISOR_ALTERNATIVE` / `UNATTRIBUTED`) — required for `SALE_CLOSED`/`SALE_LOST`, validated by orchestration (§13), not the database. |

`DecisionStatus` includes a dedicated `OVERRIDDEN` value, distinct from `REJECTED`: a rejection
means the advisor said no and did nothing; an override means the advisor acted, just not on
Kori's recommendation. The two are never conflated, and historical `REJECTED` rows were never
reinterpreted when `OVERRIDDEN` was introduced.

---

## 13. Kori Commercial Orchestration (`server/orchestration/`)

The only layer that coordinates the AI engines *and* persistence in one call — and the only place
a Prisma transaction is opened for Kori's memory.

- **`analyzeConversationAndCreateDecisions`** — the primary workflow. Both AI calls (Conversation
  Intelligence, then Decision Engine) happen *before* any transaction opens, since holding a DB
  transaction across slow network calls would be bad practice; the transaction then atomically
  persists the snapshot, every decision, and a `PROPOSED` event per decision — if any write fails,
  everything rolls back and nothing partial is left behind.
- **`decision-workflows.ts`** — `approveDecision`, `rejectDecision`, `executeDecision`,
  `recordAdvisorOverride`, all built on one deterministic transition policy
  (`decision-status-policy.ts`): `PROPOSED → APPROVED | REJECTED | OVERRIDDEN`,
  `APPROVED → EXECUTED | REJECTED | OVERRIDDEN`; every other status is terminal.
- **`outcome-workflows.ts`** — the seven `record*` outcome functions (`recordCustomerReply`
  through `recordSaleLost`), gated by `outcome-attribution-policy.ts`: a `REJECTED`/`OVERRIDDEN`/
  `CANCELLED` decision can only receive an outcome that explicitly says it *wasn't* Kori's
  recommendation playing out.
- **`transaction.ts`** — wraps every workflow: deliberate orchestration errors
  (`DecisionNotFoundError`, `InvalidDecisionStatusTransitionError`) propagate as themselves so
  callers can distinguish them; anything unexpected is wrapped in one stable
  `OrchestrationTransactionError`.

The Decision Engine is never called directly from anywhere except this layer's two entry points —
not from the WhatsApp gateway, not from a server action.

---

## 14. Kori Application Layer (`server/application/`)

The only layer allowed to know about authentication, HTTP, or the browser. Everything here follows
one fixed order — **authenticate → validate input → construct dependencies → call orchestration →
map errors** — deliberately in that sequence, so an unauthenticated or malformed request never
pays for (or leaks failures from) constructing a dependency it was never going to need.

- **`composition-root.ts`** — the single place `getAIProvider()`/`getTransactionRunner()` are
  built, each independently lazy so an action that never touches the AI provider never validates
  `AI_PROVIDER` env.
- **`auth.ts`** — `AuthContextResolver`, an explicit adapter over the existing Supabase session
  lookup (never `verifySession()`, which redirects — incompatible with a JSON result contract).
  The app's two `UserRole`s map onto Kori's authorization vocabulary: `SALESPERSON` is "advisor,"
  `OWNER` is "admin."
- **`access-control.ts`** — resolves every id (`decisionRecordId`, `conversationId`,
  `pendingMessageId`) against the caller's `businessId` server-side; a cross-tenant id returns
  `NOT_FOUND`, never `FORBIDDEN`, so existence can't be inferred from the error.
- **`errors.ts`** — the safe result contract every action returns:
  `{ok:true,data}` / `{ok:false,error:{code,message,fieldErrors?}}`. Every known orchestration/engine
  error maps to one pre-written message; nothing raw (stack traces, Prisma errors, provider
  responses, prompts, secrets) ever reaches the client.
- **`decision-actions.ts`** / **`whatsapp-actions.ts`** — the pure, Next.js-free handlers behind
  every server action, injectable for tests; `server/actions/decisions.ts` and
  `server/actions/whatsapp.ts` (§2 pattern: `"use server"` files) are thin wrappers with zero logic
  of their own.

**First advisor-facing UI:** `/decisions/[id]` (`app/(app)/decisions/[id]/page.tsx`) — a minimal
Decision Review surface (`components/decisions/DecisionReviewCard.tsx` +
`DecisionActions.tsx`) showing recommendation, reasoning, evidence, risk/impact/confidence, and a
collapsible technical section (model/provider/prompt version), with approve/reject/override/execute
buttons gated by `lib/decisions/available-actions.ts` — a pure function of status + role +
approval requirement, so the UI and its tests can never drift from the orchestration policy it
mirrors. Not a full CRM; no list view exists yet (§18).

---

## 15. WhatsApp Business Integration (`server/whatsapp/`)

The first inbound channel, and the item §10 originally deferred. Every Meta-specific concern —
webhook payload shapes, signature verification, the Graph API — lives in this one package;
nothing outside it ever imports a Meta type.

```
types.ts              raw Meta wire shapes + provider-neutral Normalized* shapes
errors.ts              typed error hierarchy
verification.ts        GET handshake + X-Hub-Signature-256 HMAC validation (constant-time)
message-normalizer.ts  per-type raw payload → NormalizedWhatsAppMessage/Status
queue.ts                PendingWhatsAppMessage CRUD + WAITING_APPROVAL→READY→SENT policy
sender.ts               WhatsAppSenderClient interface + real Graph API implementation
gateway.ts              owns the 7-step ingestion pipeline; never calls the Decision Engine directly
webhook.ts              verify → validate (Zod) → normalize → call the gateway; framework-agnostic
```

`app/api/whatsapp/webhook/route.ts` is a thin Next.js adapter over `webhook.ts` — raw body text is
read and signature-checked *before* any JSON parsing, and a webhook payload is never trusted
blindly.

**Ingestion (`WhatsAppGateway.handleInboundMessage`):** idempotency check on the WhatsApp message
id (`ConversationEntry.externalId`, unique) → identify business + phone number
(`WhatsAppPhoneNumber.phoneNumberId`, the routing key — supports many numbers per business and
many businesses per Meta app) → identify/create customer (`Lead`, matched by phone) → locate/create
`Conversation` (`source = WHATSAPP_SYNCED`, per §4's forward-compatibility note) → persist the
message and update the conversation in one write → trigger
`analyzeConversationAndCreateDecisions` — caught, never thrown, so the webhook always acks fast;
failures surface in the result for logging, not as a 500.

**Outbound:** `PendingWhatsAppMessage` — Kori never sends a WhatsApp message, only recommends one.
An advisor's reply moves `WAITING_APPROVAL → READY → SENT` through four server actions (queue,
approve, reject, send); only `READY → SENT` is implemented so far, no retries, no background
worker — `sendReadyMessage` is called explicitly, never polled.

**Schema additions this phase:** `WhatsAppPhoneNumber`, `PendingWhatsAppMessage`,
`WhatsAppMessageStatusEvent` (chronological delivery history: sent/delivered/read/failed, one row
per distinct status per message), plus two widenings — `Conversation.createdByUserId` is now
nullable (a webhook-created conversation has no human creator) and
`Conversation.whatsappPhoneNumberId` pins a thread to the business number it arrived on.

---

## 16. Domain corrections made along the way

Two small additive corrections, made when the application layer's authorization/outcome rules
exposed a gap in the persistence model from §12:

- **`OVERRIDDEN` as its own `DecisionStatus`** (not a rename of `REJECTED`) — see §12.
- **`Outcome.attribution`** — the smallest field that could represent both "why is this outcome
  valid against a non-executed decision" and "who does this sale attribute to," reusing one enum
  (`KORI_RECOMMENDATION` / `ADVISOR_ALTERNATIVE` / `UNATTRIBUTED`) for both, enforced by
  `outcome-attribution-policy.ts` (§13) rather than a database constraint.

---

## 17. Testing conventions established across Part II

- **Unit tests** never touch a real database — every Prisma-touching function/class accepts an
  injectable `PrismaClientOrTransaction` (default: the app's shared singleton), and orchestration
  tests use `createFakeTransactionRunner` (`server/orchestration/__tests__/fakes.ts`): a real
  commit-or-discard in-memory double, not a call-recording mock, so rollback assertions are
  genuinely deterministic.
- **DB integration tests** (`*.db.test.ts`) are gated behind `RUN_DB_TESTS=true` and run only
  against an isolated local Postgres instance (`sales_os_test`, see `.env.test.local`, gitignored)
  — never the pilot database this repo's `.env` points at. `server-only` is aliased to an inert
  shim for Vitest (`test/shims/server-only.ts`), since only Next.js's bundler makes the real
  package a no-op.
- **No real network calls** — the AI provider is always mocked (`createMockAIProvider`) and the
  WhatsApp Graph API is always stubbed (`vi.stubGlobal("fetch", ...)`); `RUN_REAL_AI_TESTS=true` is
  a separate, explicit opt-in never exercised by default.

---

## 18. What Part II deliberately has not built yet

Carried over from §10's spirit — explicitly out of scope for every phase so far, not forgotten:

- **The Learning Engine** — nothing reads `AdvisorAction`/`Outcome`/attribution history yet; §12
  only built the ledger.
- Automatic/autonomous replies of any kind — Kori recommends, a human always queues and sends
  (§14, §15). This remains the same hard boundary §10 already drew.
- A list view over `DecisionRecord`/`PendingWhatsAppMessage` — `/decisions/[id]` (§14) has no index
  page; there is no "Today"-style entry point into Kori's queue yet.
- Retries, a background worker, or a job queue for outbound WhatsApp sending (§15).
- Media download (WhatsApp media is stored as metadata only — id, mime type, filename, size,
  caption; §15).
- Email, Instagram, or any second channel — `server/whatsapp/` is intentionally not a generic
  channel framework; a second channel gets its own package producing the same
  `Normalized*`/orchestration-call shape, not a shared abstraction extracted in advance.
- Advisor scoring, analytics, dashboards — unchanged from §10.

---

**Status:** §1–§10 is the original proposal (partially superseded, see above). Part II (§11–§18)
reflects what has actually been built and tested as of the WhatsApp Business Integration v1 phase.

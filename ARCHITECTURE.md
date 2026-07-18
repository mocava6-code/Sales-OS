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

**Status: awaiting approval.** No application code has been written against this proposal.

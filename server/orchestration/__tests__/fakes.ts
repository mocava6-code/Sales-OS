// In-memory test doubles for the persistence layer. Gives orchestration
// unit tests a TransactionRunner with *real* commit-or-rollback semantics —
// `work` runs against a cloned working copy of the store, which only
// replaces the real store if `work` resolves — without needing a database.
// This is what makes rollback assertions (tests #2, #3) deterministic rather
// than dependent on real Postgres behavior.

import { randomUUID } from "node:crypto";
import type { DecisionStatus } from "../../intelligence/decision/types";
import type {
  AdvisorActionRepository,
  ConversationSnapshotRepository,
  DecisionEventRepository,
  DecisionRepository,
  DomainEventRepository,
  ObservationRepository,
  OutcomeRepository,
} from "../../persistence/repositories";
import type {
  AdvisorActionRecord,
  AppendDecisionEventInput,
  DecisionEventRecord,
  OutcomeRecord,
  RecordAdvisorActionInput,
  RecordOutcomeInput,
  SaveConversationSnapshotInput,
  SaveDecisionInput,
  SaveDomainEventInput,
  SaveObservationInput,
  SavedConversationSnapshot,
  SavedDecisionRecord,
  SavedDomainEventRecord,
  SavedObservationRecord,
} from "../../persistence/types";
import type { KoriUnitOfWork, TransactionRunner } from "../../persistence/unit-of-work";

export interface FakeStore {
  conversationSnapshots: Map<string, SavedConversationSnapshot>;
  decisions: Map<string, SavedDecisionRecord>;
  decisionEvents: Map<string, DecisionEventRecord>;
  advisorActions: Map<string, AdvisorActionRecord>;
  outcomes: Map<string, OutcomeRecord>;
  domainEvents: Map<string, SavedDomainEventRecord>;
  observations: Map<string, SavedObservationRecord>;
}

export function createEmptyStore(): FakeStore {
  return {
    conversationSnapshots: new Map(),
    decisions: new Map(),
    decisionEvents: new Map(),
    advisorActions: new Map(),
    outcomes: new Map(),
    domainEvents: new Map(),
    observations: new Map(),
  };
}

function byChronological<T extends { occurredAt: Date } | { createdAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = "occurredAt" in a ? a.occurredAt.getTime() : a.createdAt.getTime();
    const bTime = "occurredAt" in b ? b.occurredAt.getTime() : b.createdAt.getTime();
    return aTime - bTime;
  });
}

function createFakeConversationSnapshotRepository(store: FakeStore): ConversationSnapshotRepository {
  return {
    async save(input: SaveConversationSnapshotInput): Promise<SavedConversationSnapshot> {
      const saved: SavedConversationSnapshot = {
        id: randomUUID(),
        businessId: input.businessId,
        conversationId: input.conversationId,
        result: input.result,
        createdAt: new Date(),
      };
      store.conversationSnapshots.set(saved.id, saved);
      return saved;
    },
    async findLatestForConversation(conversationId) {
      const matches = byChronological(
        [...store.conversationSnapshots.values()].filter((s) => s.conversationId === conversationId),
      );
      return matches.length ? matches[matches.length - 1] : null;
    },
    async listForConversation(conversationId) {
      return byChronological([...store.conversationSnapshots.values()].filter((s) => s.conversationId === conversationId));
    },
  };
}

function createFakeDecisionRepository(store: FakeStore): DecisionRepository {
  return {
    async save(input: SaveDecisionInput): Promise<SavedDecisionRecord> {
      const saved: SavedDecisionRecord = {
        id: randomUUID(),
        businessId: input.businessId,
        conversationId: input.decision.metadata.conversationId,
        conversationSnapshotId: input.conversationSnapshotId ?? null,
        decision: input.decision,
        createdAt: new Date(),
      };
      store.decisions.set(saved.id, saved);
      return saved;
    },
    async findById(id) {
      return store.decisions.get(id) ?? null;
    },
    async listForConversation(conversationId) {
      return byChronological([...store.decisions.values()].filter((d) => d.conversationId === conversationId));
    },
    async updateStatus(id: string, status: DecisionStatus) {
      const existing = store.decisions.get(id);
      if (!existing) {
        throw new Error(`Fake store: no DecisionRecord with id "${id}".`);
      }
      const updated: SavedDecisionRecord = { ...existing, decision: { ...existing.decision, status } };
      store.decisions.set(id, updated);
      return updated;
    },
  };
}

function createFakeDecisionEventRepository(store: FakeStore): DecisionEventRepository {
  return {
    async append(input: AppendDecisionEventInput): Promise<DecisionEventRecord> {
      const saved: DecisionEventRecord = {
        id: randomUUID(),
        decisionRecordId: input.decisionRecordId,
        eventType: input.eventType,
        occurredAt: input.occurredAt ?? new Date(),
        note: input.note ?? null,
        createdAt: new Date(),
      };
      store.decisionEvents.set(saved.id, saved);
      return saved;
    },
    async listForDecision(decisionRecordId) {
      return byChronological([...store.decisionEvents.values()].filter((e) => e.decisionRecordId === decisionRecordId));
    },
  };
}

function createFakeAdvisorActionRepository(store: FakeStore): AdvisorActionRepository {
  return {
    async record(input: RecordAdvisorActionInput): Promise<AdvisorActionRecord> {
      const saved: AdvisorActionRecord = {
        id: randomUUID(),
        decisionRecordId: input.decisionRecordId,
        actionType: input.actionType,
        advisorUserId: input.advisorUserId ?? null,
        notes: input.notes ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        createdAt: new Date(),
      };
      store.advisorActions.set(saved.id, saved);
      return saved;
    },
    async listForDecision(decisionRecordId) {
      return byChronological([...store.advisorActions.values()].filter((a) => a.decisionRecordId === decisionRecordId));
    },
  };
}

function createFakeOutcomeRepository(store: FakeStore): OutcomeRepository {
  return {
    async record(input: RecordOutcomeInput): Promise<OutcomeRecord> {
      const saved: OutcomeRecord = {
        id: randomUUID(),
        decisionRecordId: input.decisionRecordId,
        outcomeType: input.outcomeType,
        attribution: input.attribution ?? null,
        notes: input.notes ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        createdAt: new Date(),
      };
      store.outcomes.set(saved.id, saved);
      return saved;
    },
    async listForDecision(decisionRecordId) {
      return byChronological([...store.outcomes.values()].filter((o) => o.decisionRecordId === decisionRecordId));
    },
  };
}

function createFakeDomainEventRepository(store: FakeStore): DomainEventRepository {
  return {
    async append(input: SaveDomainEventInput): Promise<SavedDomainEventRecord> {
      const saved: SavedDomainEventRecord = {
        id: randomUUID(),
        businessId: input.businessId,
        conversationId: input.conversationId,
        conversationEntryId: input.conversationEntryId ?? null,
        eventType: input.event.type,
        event: input.event,
        occurredAt: input.event.occurredAt,
        createdAt: new Date(),
      };
      store.domainEvents.set(saved.id, saved);
      return saved;
    },
    async listForConversation(conversationId) {
      return byChronological([...store.domainEvents.values()].filter((e) => e.conversationId === conversationId));
    },
  };
}

function createFakeObservationRepository(store: FakeStore): ObservationRepository {
  return {
    async save(input: SaveObservationInput): Promise<SavedObservationRecord> {
      const saved: SavedObservationRecord = {
        id: randomUUID(),
        businessId: input.businessId,
        conversationId: input.conversationId,
        domainEventId: input.domainEventId,
        conversationEntryId: input.conversationEntryId ?? null,
        observation: input.observation,
        occurredAt: input.occurredAt,
        createdAt: new Date(),
      };
      store.observations.set(saved.id, saved);
      return saved;
    },
    async listForConversation(conversationId) {
      return byChronological([...store.observations.values()].filter((o) => o.conversationId === conversationId));
    },
    async aggregateByType(businessId) {
      const counts = new Map<string, { count: number; lastSeenAt: Date }>();
      for (const o of store.observations.values()) {
        if (o.businessId !== businessId) continue;
        const existing = counts.get(o.observation.type);
        const lastSeenAt = existing && existing.lastSeenAt > o.occurredAt ? existing.lastSeenAt : o.occurredAt;
        counts.set(o.observation.type, { count: (existing?.count ?? 0) + 1, lastSeenAt });
      }
      return [...counts.entries()].map(([type, v]) => ({ type: type as never, ...v }));
    },
  };
}

/** Lets a test wrap one repository with fault-injecting/spy behavior, layered on top of the base in-memory fake. */
export interface FakeRepositoryOverrides {
  conversationSnapshots?: (base: ConversationSnapshotRepository) => ConversationSnapshotRepository;
  decisions?: (base: DecisionRepository) => DecisionRepository;
  decisionEvents?: (base: DecisionEventRepository) => DecisionEventRepository;
  advisorActions?: (base: AdvisorActionRepository) => AdvisorActionRepository;
  outcomes?: (base: OutcomeRepository) => OutcomeRepository;
  domainEvents?: (base: DomainEventRepository) => DomainEventRepository;
  observations?: (base: ObservationRepository) => ObservationRepository;
}

function buildUow(store: FakeStore, overrides: FakeRepositoryOverrides): KoriUnitOfWork {
  return {
    conversationSnapshots: overrides.conversationSnapshots?.(createFakeConversationSnapshotRepository(store)) ??
      createFakeConversationSnapshotRepository(store),
    decisions: overrides.decisions?.(createFakeDecisionRepository(store)) ?? createFakeDecisionRepository(store),
    decisionEvents: overrides.decisionEvents?.(createFakeDecisionEventRepository(store)) ??
      createFakeDecisionEventRepository(store),
    advisorActions: overrides.advisorActions?.(createFakeAdvisorActionRepository(store)) ??
      createFakeAdvisorActionRepository(store),
    outcomes: overrides.outcomes?.(createFakeOutcomeRepository(store)) ?? createFakeOutcomeRepository(store),
    domainEvents: overrides.domainEvents?.(createFakeDomainEventRepository(store)) ??
      createFakeDomainEventRepository(store),
    observations: overrides.observations?.(createFakeObservationRepository(store)) ??
      createFakeObservationRepository(store),
  };
}

export interface FakeTransactionRunnerHandle {
  runner: TransactionRunner;
  /** The committed store — only ever reflects successfully-completed transactions. */
  store: FakeStore;
}

export function createFakeTransactionRunner(overrides: FakeRepositoryOverrides = {}): FakeTransactionRunnerHandle {
  const store = createEmptyStore();

  const runner: TransactionRunner = {
    async runInTransaction<T>(work: (uow: KoriUnitOfWork) => Promise<T>): Promise<T> {
      const working: FakeStore = structuredClone(store);
      const uow = buildUow(working, overrides);
      const result = await work(uow);
      // Only reached if `work` resolved — on throw, `working` is discarded
      // and `store` (what the test asserts against) is untouched.
      store.conversationSnapshots = working.conversationSnapshots;
      store.decisions = working.decisions;
      store.decisionEvents = working.decisionEvents;
      store.advisorActions = working.advisorActions;
      store.outcomes = working.outcomes;
      store.domainEvents = working.domainEvents;
      store.observations = working.observations;
      return result;
    },
  };

  return { runner, store };
}

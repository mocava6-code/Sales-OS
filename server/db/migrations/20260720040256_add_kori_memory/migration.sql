-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('RESPOND_TO_CUSTOMER', 'ASK_CLARIFYING_QUESTION', 'FOLLOW_UP', 'ESCALATE_TO_HUMAN', 'RECOMMEND_SALES_APPROACH', 'WARN_ADVISOR', 'ORGANIZE_CONVERSATION', 'WAIT', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "DecisionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DecisionImpactLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DecisionApprovalRequirement" AS ENUM ('AUTO_ALLOWED', 'ADVISOR_APPROVAL_REQUIRED', 'ADMIN_APPROVAL_REQUIRED', 'HUMAN_INFORMATION_REQUIRED');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DecisionEventType" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED', 'CUSTOMER_REPLIED', 'FOLLOW_UP_SENT', 'SALE_CLOSED', 'SALE_LOST', 'ADVISOR_OVERRIDDEN', 'KORI_OVERRIDDEN');

-- CreateEnum
CREATE TYPE "AdvisorActionType" AS ENUM ('FOLLOWED_RECOMMENDATION', 'IGNORED_RECOMMENDATION', 'PARTIALLY_FOLLOWED_RECOMMENDATION', 'CUSTOM_ACTION');

-- CreateEnum
CREATE TYPE "OutcomeType" AS ENUM ('CUSTOMER_REPLIED', 'MEETING_SCHEDULED', 'QUOTATION_REQUESTED', 'QUOTATION_SENT', 'SALE_CLOSED', 'SALE_LOST', 'ABANDONED');

-- CreateTable
CREATE TABLE "conversation_snapshots" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerIdentification" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "inferences" JSONB NOT NULL,
    "objections" JSONB NOT NULL,
    "missingInformation" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "draftResponse" JSONB,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "engineSchemaVersion" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "aiProvider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_records" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "conversationSnapshotId" TEXT,
    "engineDecisionId" TEXT NOT NULL,
    "type" "DecisionType" NOT NULL,
    "title" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "assumptions" TEXT[],
    "missingInformation" JSONB NOT NULL,
    "alternatives" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "riskLevel" "DecisionRiskLevel" NOT NULL,
    "impactLevel" "DecisionImpactLevel" NOT NULL,
    "approvalRequirement" "DecisionApprovalRequirement" NOT NULL,
    "suggestedAction" JSONB NOT NULL,
    "customerProfile" JSONB,
    "warnings" JSONB NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "engineSchemaVersion" INTEGER NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "aiProvider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "sourceConversationIntelligenceGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_events" (
    "id" TEXT NOT NULL,
    "decisionRecordId" TEXT NOT NULL,
    "eventType" "DecisionEventType" NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisor_actions" (
    "id" TEXT NOT NULL,
    "decisionRecordId" TEXT NOT NULL,
    "actionType" "AdvisorActionType" NOT NULL,
    "advisorUserId" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisor_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcomes" (
    "id" TEXT NOT NULL,
    "decisionRecordId" TEXT NOT NULL,
    "outcomeType" "OutcomeType" NOT NULL,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_snapshots_conversationId_createdAt_idx" ON "conversation_snapshots"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_snapshots_businessId_idx" ON "conversation_snapshots"("businessId");

-- CreateIndex
CREATE INDEX "decision_records_conversationId_idx" ON "decision_records"("conversationId");

-- CreateIndex
CREATE INDEX "decision_records_businessId_idx" ON "decision_records"("businessId");

-- CreateIndex
CREATE INDEX "decision_records_status_idx" ON "decision_records"("status");

-- CreateIndex
CREATE INDEX "decision_records_conversationSnapshotId_idx" ON "decision_records"("conversationSnapshotId");

-- CreateIndex
CREATE INDEX "decision_events_decisionRecordId_occurredAt_idx" ON "decision_events"("decisionRecordId", "occurredAt");

-- CreateIndex
CREATE INDEX "advisor_actions_decisionRecordId_idx" ON "advisor_actions"("decisionRecordId");

-- CreateIndex
CREATE INDEX "outcomes_decisionRecordId_idx" ON "outcomes"("decisionRecordId");

-- AddForeignKey
ALTER TABLE "conversation_snapshots" ADD CONSTRAINT "conversation_snapshots_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_snapshots" ADD CONSTRAINT "conversation_snapshots_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_conversationSnapshotId_fkey" FOREIGN KEY ("conversationSnapshotId") REFERENCES "conversation_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_decisionRecordId_fkey" FOREIGN KEY ("decisionRecordId") REFERENCES "decision_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisor_actions" ADD CONSTRAINT "advisor_actions_decisionRecordId_fkey" FOREIGN KEY ("decisionRecordId") REFERENCES "decision_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisor_actions" ADD CONSTRAINT "advisor_actions_advisorUserId_fkey" FOREIGN KEY ("advisorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_decisionRecordId_fkey" FOREIGN KEY ("decisionRecordId") REFERENCES "decision_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

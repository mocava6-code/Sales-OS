/*
  Warnings:

  - Added the required column `approvedAt` to the `knowledge_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `approvedByUserId` to the `knowledge_items` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('WEBSITE', 'WHATSAPP_IMPORT');

-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ExternalConversationSource" AS ENUM ('WHATSAPP_TXT_EXPORT', 'WHATSAPP_ZIP_EXPORT', 'PASTED_TEXT');

-- CreateEnum
CREATE TYPE "ImportDateOrder" AS ENUM ('DMY', 'MDY');

-- CreateEnum
CREATE TYPE "ImportedMessageRole" AS ENUM ('BUSINESS', 'CUSTOMER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImportedConversationResolutionMethod" AS ENUM ('DETERMINISTIC_USER_MATCH', 'MANUAL_PROMPT', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "WebsitePageStatus" AS ENUM ('DISCOVERED', 'FETCHED', 'EXTRACTED', 'SKIPPED_UNCHANGED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebsitePageContext" AS ENUM ('PRODUCT', 'SERVICE', 'FAQ', 'POLICY', 'MARKETING', 'TESTIMONIAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "KnowledgeCandidateClass" AS ENUM ('FACTUAL', 'BEHAVIORAL');

-- CreateEnum
CREATE TYPE "KnowledgeCandidateStatus" AS ENUM ('NEW', 'REINFORCED', 'CONFLICT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RelationshipClassification" AS ENUM ('EQUIVALENT', 'CONTRADICTORY', 'RELATED', 'UNRELATED');

-- CreateEnum
CREATE TYPE "EvidenceRefType" AS ENUM ('IMPORTED_MESSAGE', 'WEBSITE_PAGE', 'CONVERSATION_ENTRY');

-- CreateEnum
CREATE TYPE "BehaviorCategory" AS ENUM ('PROCESS_PATTERN', 'SALES_BEHAVIOR', 'CUSTOMER_PATTERN');

-- CreateEnum
CREATE TYPE "KnowledgeItemStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "KnowledgeCategory" ADD VALUE 'PRICING';

-- AlterTable
ALTER TABLE "knowledge_items" ADD COLUMN     "approvedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "approvedByUserId" TEXT NOT NULL,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "originCandidateId" TEXT,
ADD COLUMN     "status" "KnowledgeItemStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "supersededByItemId" TEXT;

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'PENDING',
    "progressTotal" INTEGER,
    "progressCompleted" INTEGER,
    "progressFailed" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastRunSummary" JSONB,
    "errorMessage" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_conversations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalSource" "ExternalConversationSource" NOT NULL,
    "sourceConversationId" TEXT NOT NULL,
    "participantLabels" TEXT[],
    "dateOrder" "ImportDateOrder" NOT NULL DEFAULT 'DMY',
    "timezone" TEXT NOT NULL DEFAULT 'America/Lima',
    "resolvedBusinessSenderLabel" TEXT,
    "resolutionMethod" "ImportedConversationResolutionMethod",
    "rawFileHash" TEXT,
    "parseWarnings" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_messages" (
    "id" TEXT NOT NULL,
    "importedConversationId" TEXT NOT NULL,
    "senderLabel" TEXT,
    "resolvedRole" "ImportedMessageRole" NOT NULL DEFAULT 'UNKNOWN',
    "occurredAt" TIMESTAMP(3),
    "content" TEXT NOT NULL,
    "rawLine" TEXT NOT NULL,
    "sequenceIndex" INTEGER NOT NULL,

    CONSTRAINT "imported_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_pages" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "title" TEXT,
    "extractedText" TEXT,
    "contentHash" TEXT,
    "pageContext" "WebsitePageContext" NOT NULL DEFAULT 'UNKNOWN',
    "status" "WebsitePageStatus" NOT NULL DEFAULT 'DISCOVERED',
    "httpStatus" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangedAt" TIMESTAMP(3),

    CONSTRAINT "website_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_candidates" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "class" "KnowledgeCandidateClass" NOT NULL,
    "proposedFactualCategory" "KnowledgeCategory",
    "proposedBehaviorCategory" "BehaviorCategory",
    "subject" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "originSourceId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "KnowledgeCandidateStatus" NOT NULL DEFAULT 'NEW',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "extractorName" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "promotedKnowledgeItemId" TEXT,
    "promotedOperationalInsightId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_candidate_relationships" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "targetCandidateId" TEXT,
    "targetKnowledgeItemId" TEXT,
    "targetOperationalInsightId" TEXT,
    "classification" "RelationshipClassification" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "classifierName" TEXT,
    "classifierVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_candidate_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_candidate_evidence" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "evidenceRefType" "EvidenceRefType" NOT NULL,
    "evidenceRefId" TEXT NOT NULL,
    "evidenceText" TEXT NOT NULL,
    "chunkContext" "WebsitePageContext",
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_candidate_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_insights" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "category" "BehaviorCategory" NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "KnowledgeItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "originCandidateId" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_sources_businessId_idx" ON "knowledge_sources"("businessId");

-- CreateIndex
CREATE INDEX "imported_conversations_businessId_idx" ON "imported_conversations"("businessId");

-- CreateIndex
CREATE INDEX "imported_conversations_sourceId_idx" ON "imported_conversations"("sourceId");

-- CreateIndex
CREATE INDEX "imported_messages_importedConversationId_idx" ON "imported_messages"("importedConversationId");

-- CreateIndex
CREATE INDEX "website_pages_businessId_idx" ON "website_pages"("businessId");

-- CreateIndex
CREATE INDEX "website_pages_sourceId_status_idx" ON "website_pages"("sourceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "website_pages_sourceId_url_key" ON "website_pages"("sourceId", "url");

-- CreateIndex
CREATE INDEX "knowledge_candidates_businessId_idx" ON "knowledge_candidates"("businessId");

-- CreateIndex
CREATE INDEX "knowledge_candidates_businessId_status_idx" ON "knowledge_candidates"("businessId", "status");

-- CreateIndex
CREATE INDEX "knowledge_candidates_originSourceId_idx" ON "knowledge_candidates"("originSourceId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_relationships_businessId_idx" ON "knowledge_candidate_relationships"("businessId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_relationships_candidateId_idx" ON "knowledge_candidate_relationships"("candidateId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_relationships_targetCandidateId_idx" ON "knowledge_candidate_relationships"("targetCandidateId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_relationships_targetKnowledgeItemId_idx" ON "knowledge_candidate_relationships"("targetKnowledgeItemId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_relationships_targetOperationalInsightI_idx" ON "knowledge_candidate_relationships"("targetOperationalInsightId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_evidence_candidateId_idx" ON "knowledge_candidate_evidence"("candidateId");

-- CreateIndex
CREATE INDEX "knowledge_candidate_evidence_sourceId_idx" ON "knowledge_candidate_evidence"("sourceId");

-- CreateIndex
CREATE INDEX "operational_insights_businessId_idx" ON "operational_insights"("businessId");

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_conversations" ADD CONSTRAINT "imported_conversations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_conversations" ADD CONSTRAINT "imported_conversations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_messages" ADD CONSTRAINT "imported_messages_importedConversationId_fkey" FOREIGN KEY ("importedConversationId") REFERENCES "imported_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_originSourceId_fkey" FOREIGN KEY ("originSourceId") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_relationships" ADD CONSTRAINT "knowledge_candidate_relationships_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_relationships" ADD CONSTRAINT "knowledge_candidate_relationships_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "knowledge_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_relationships" ADD CONSTRAINT "knowledge_candidate_relationships_targetCandidateId_fkey" FOREIGN KEY ("targetCandidateId") REFERENCES "knowledge_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_relationships" ADD CONSTRAINT "knowledge_candidate_relationships_targetKnowledgeItemId_fkey" FOREIGN KEY ("targetKnowledgeItemId") REFERENCES "knowledge_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_relationships" ADD CONSTRAINT "knowledge_candidate_relationships_targetOperationalInsight_fkey" FOREIGN KEY ("targetOperationalInsightId") REFERENCES "operational_insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_evidence" ADD CONSTRAINT "knowledge_candidate_evidence_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "knowledge_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidate_evidence" ADD CONSTRAINT "knowledge_candidate_evidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_insights" ADD CONSTRAINT "operational_insights_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_insights" ADD CONSTRAINT "operational_insights_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

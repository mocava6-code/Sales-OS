-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'SALESPERSON');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP', 'CALL', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationSource" AS ENUM ('MANUAL_PASTE', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('NEEDS_REPLY', 'WAITING_ON_CUSTOMER', 'CLOSED');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE', 'SNOOZED');

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('PRODUCT', 'COMPATIBILITY', 'OBJECTION', 'COMMERCIAL_POLICY', 'PROMOTION', 'FAQ', 'RECOMMENDED_RESPONSE', 'LOGISTICS');

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToUserId" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "source" "ConversationSource" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEEDS_REPLY',
    "lastEntryAt" TIMESTAMP(3) NOT NULL,
    "lastEntryDirection" "EntryDirection" NOT NULL,
    "aiSummary" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_entries" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "tags" TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_insights" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insightDate" TIMESTAMP(3) NOT NULL,
    "observation" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_evidence" (
    "id" TEXT NOT NULL,
    "dailyInsightId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "excerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_name_key" ON "businesses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_authUserId_key" ON "users"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "leads_businessId_idx" ON "leads"("businessId");

-- CreateIndex
CREATE INDEX "conversations_businessId_idx" ON "conversations"("businessId");

-- CreateIndex
CREATE INDEX "conversations_leadId_idx" ON "conversations"("leadId");

-- CreateIndex
CREATE INDEX "conversation_entries_conversationId_idx" ON "conversation_entries"("conversationId");

-- CreateIndex
CREATE INDEX "follow_ups_leadId_idx" ON "follow_ups"("leadId");

-- CreateIndex
CREATE INDEX "follow_ups_userId_idx" ON "follow_ups"("userId");

-- CreateIndex
CREATE INDEX "knowledge_items_businessId_idx" ON "knowledge_items"("businessId");

-- CreateIndex
CREATE INDEX "daily_insights_businessId_userId_insightDate_idx" ON "daily_insights"("businessId", "userId", "insightDate");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_entries" ADD CONSTRAINT "conversation_entries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_dailyInsightId_fkey" FOREIGN KEY ("dailyInsightId") REFERENCES "daily_insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

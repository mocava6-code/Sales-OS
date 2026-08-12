-- CreateEnum
CREATE TYPE "ConversationActionStateValue" AS ENUM ('REPLY_REQUIRED', 'FOLLOW_UP_REQUIRED', 'WAITING_ON_CUSTOMER', 'NO_ACTION_REQUIRED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ConversationActionStateSource" AS ENUM ('DETERMINISTIC', 'AI', 'HUMAN', 'FOLLOW_UP', 'DECISION_ENGINE');

-- CreateTable
CREATE TABLE "conversation_action_states" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actionState" "ConversationActionStateValue" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "evidenceEntryIds" TEXT[],
    "recommendedAction" TEXT,
    "source" "ConversationActionStateSource" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "basedOnLastEntryAt" TIMESTAMP(3) NOT NULL,
    "basedOnEntryCount" INTEGER NOT NULL,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "humanSetByUserId" TEXT,
    "humanSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_action_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_action_states_conversationId_key" ON "conversation_action_states"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_action_states_businessId_actionState_idx" ON "conversation_action_states"("businessId", "actionState");

-- AddForeignKey
ALTER TABLE "conversation_action_states" ADD CONSTRAINT "conversation_action_states_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_action_states" ADD CONSTRAINT "conversation_action_states_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_action_states" ADD CONSTRAINT "conversation_action_states_humanSetByUserId_fkey" FOREIGN KEY ("humanSetByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

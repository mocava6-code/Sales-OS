-- CreateEnum
CREATE TYPE "OutcomeAttribution" AS ENUM ('KORI_RECOMMENDATION', 'ADVISOR_ALTERNATIVE', 'UNATTRIBUTED');

-- AlterEnum
ALTER TYPE "DecisionStatus" ADD VALUE 'OVERRIDDEN';

-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN     "attribution" "OutcomeAttribution";

-- CreateTable
CREATE TABLE "conversation_analysis_runs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_analysis_runs_conversationId_key" ON "conversation_analysis_runs"("conversationId");

-- AddForeignKey
ALTER TABLE "conversation_analysis_runs" ADD CONSTRAINT "conversation_analysis_runs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_analysis_runs" ADD CONSTRAINT "conversation_analysis_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

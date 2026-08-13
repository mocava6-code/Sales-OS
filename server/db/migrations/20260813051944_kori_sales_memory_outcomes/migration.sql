-- AlterEnum
ALTER TYPE "OutcomeType" ADD VALUE 'NOT_AN_OPPORTUNITY';

-- DropForeignKey
ALTER TABLE "outcomes" DROP CONSTRAINT "outcomes_decisionRecordId_fkey";

-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN     "businessId" TEXT NOT NULL,
ADD COLUMN     "conversationId" TEXT NOT NULL,
ADD COLUMN     "lostReason" TEXT,
ADD COLUMN     "productSold" TEXT,
ADD COLUMN     "recordedByUserId" TEXT,
ALTER COLUMN "decisionRecordId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "outcomes_businessId_idx" ON "outcomes"("businessId");

-- CreateIndex
CREATE INDEX "outcomes_conversationId_idx" ON "outcomes"("conversationId");

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_decisionRecordId_fkey" FOREIGN KEY ("decisionRecordId") REFERENCES "decision_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "CustomerTypeProfile" AS ENUM ('RETAIL', 'WHOLESALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LeadNextAction" AS ENUM ('ANSWER_QUESTION', 'CONFIRM_PAYMENT', 'SCHEDULE_DELIVERY', 'SEND_QUOTE', 'FOLLOW_UP', 'NONE');

-- CreateTable
CREATE TABLE "lead_commercial_profiles" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vehicleBrand" TEXT,
    "vehicleModel" TEXT,
    "vehicleYear" INTEGER,
    "productInterest" TEXT,
    "customerType" "CustomerTypeProfile",
    "nextAction" "LeadNextAction",
    "nextActionReason" TEXT,
    "primaryObjection" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_commercial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_commercial_profiles_leadId_key" ON "lead_commercial_profiles"("leadId");

-- CreateIndex
CREATE INDEX "lead_commercial_profiles_businessId_vehicleBrand_idx" ON "lead_commercial_profiles"("businessId", "vehicleBrand");

-- CreateIndex
CREATE INDEX "lead_commercial_profiles_businessId_vehicleModel_idx" ON "lead_commercial_profiles"("businessId", "vehicleModel");

-- CreateIndex
CREATE INDEX "lead_commercial_profiles_businessId_productInterest_idx" ON "lead_commercial_profiles"("businessId", "productInterest");

-- CreateIndex
CREATE INDEX "lead_commercial_profiles_businessId_customerType_idx" ON "lead_commercial_profiles"("businessId", "customerType");

-- CreateIndex
CREATE INDEX "lead_commercial_profiles_businessId_nextAction_idx" ON "lead_commercial_profiles"("businessId", "nextAction");

-- AddForeignKey
ALTER TABLE "lead_commercial_profiles" ADD CONSTRAINT "lead_commercial_profiles_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

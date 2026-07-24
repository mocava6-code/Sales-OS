-- CreateEnum
CREATE TYPE "DomainEventType" AS ENUM ('CONVERSATION_CREATED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'ATTACHMENT_RECEIVED', 'CONVERSATION_CLOSED');

-- CreateEnum
CREATE TYPE "ObservationType" AS ENUM ('PRICE_REQUEST', 'COMPATIBILITY_QUESTION', 'INSTALLATION_QUESTION', 'CUSTOMER_GHOSTED', 'PHOTO_REQUEST', 'DISCOUNT_NEGOTIATION');

-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "conversationEntryId" TEXT,
    "eventType" "DomainEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "domainEventId" TEXT NOT NULL,
    "conversationEntryId" TEXT,
    "type" "ObservationType" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_events_conversationId_occurredAt_idx" ON "domain_events"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_events_businessId_idx" ON "domain_events"("businessId");

-- CreateIndex
CREATE INDEX "domain_events_eventType_idx" ON "domain_events"("eventType");

-- CreateIndex
CREATE INDEX "observations_conversationId_occurredAt_idx" ON "observations"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "observations_businessId_idx" ON "observations"("businessId");

-- CreateIndex
CREATE INDEX "observations_type_idx" ON "observations"("type");

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_domainEventId_fkey" FOREIGN KEY ("domainEventId") REFERENCES "domain_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

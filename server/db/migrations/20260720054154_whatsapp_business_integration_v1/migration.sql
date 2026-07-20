-- CreateEnum
CREATE TYPE "ConversationEntryMessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER', 'CONTACT', 'LOCATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PendingWhatsAppMessageStatus" AS ENUM ('READY', 'WAITING_APPROVAL', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
ALTER TYPE "ConversationSource" ADD VALUE 'WHATSAPP_SYNCED';

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_createdByUserId_fkey";

-- AlterTable
ALTER TABLE "conversation_entries" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "mediaCaption" TEXT,
ADD COLUMN     "mediaFilename" TEXT,
ADD COLUMN     "mediaId" TEXT,
ADD COLUMN     "mediaMimeType" TEXT,
ADD COLUMN     "mediaSizeBytes" INTEGER,
ADD COLUMN     "messageType" "ConversationEntryMessageType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "quotedExternalId" TEXT,
ADD COLUMN     "rawPayload" JSONB;

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "whatsapp_phone_numbers" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_whatsapp_messages" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "whatsappPhoneNumberId" TEXT NOT NULL,
    "toPhoneNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PendingWhatsAppMessageStatus" NOT NULL DEFAULT 'WAITING_APPROVAL',
    "decisionRecordId" TEXT,
    "createdByUserId" TEXT,
    "externalId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "pending_whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_message_status_events" (
    "id" TEXT NOT NULL,
    "pendingMessageId" TEXT NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_message_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_phone_numbers_phoneNumberId_key" ON "whatsapp_phone_numbers"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_phone_numbers_businessId_idx" ON "whatsapp_phone_numbers"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_whatsapp_messages_externalId_key" ON "pending_whatsapp_messages"("externalId");

-- CreateIndex
CREATE INDEX "pending_whatsapp_messages_businessId_idx" ON "pending_whatsapp_messages"("businessId");

-- CreateIndex
CREATE INDEX "pending_whatsapp_messages_conversationId_idx" ON "pending_whatsapp_messages"("conversationId");

-- CreateIndex
CREATE INDEX "pending_whatsapp_messages_status_idx" ON "pending_whatsapp_messages"("status");

-- CreateIndex
CREATE INDEX "whatsapp_message_status_events_pendingMessageId_idx" ON "whatsapp_message_status_events"("pendingMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_message_status_events_pendingMessageId_status_key" ON "whatsapp_message_status_events"("pendingMessageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_entries_externalId_key" ON "conversation_entries"("externalId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_whatsapp_messages" ADD CONSTRAINT "pending_whatsapp_messages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_whatsapp_messages" ADD CONSTRAINT "pending_whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_whatsapp_messages" ADD CONSTRAINT "pending_whatsapp_messages_whatsappPhoneNumberId_fkey" FOREIGN KEY ("whatsappPhoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_whatsapp_messages" ADD CONSTRAINT "pending_whatsapp_messages_decisionRecordId_fkey" FOREIGN KEY ("decisionRecordId") REFERENCES "decision_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_whatsapp_messages" ADD CONSTRAINT "pending_whatsapp_messages_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_status_events" ADD CONSTRAINT "whatsapp_message_status_events_pendingMessageId_fkey" FOREIGN KEY ("pendingMessageId") REFERENCES "pending_whatsapp_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "whatsappPhoneNumberId" TEXT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsappPhoneNumberId_fkey" FOREIGN KEY ("whatsappPhoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


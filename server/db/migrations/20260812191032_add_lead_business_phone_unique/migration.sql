-- CreateIndex
CREATE UNIQUE INDEX "leads_businessId_phone_key" ON "leads"("businessId", "phone");

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ObservationType" ADD VALUE 'QUOTE_REQUEST';
ALTER TYPE "ObservationType" ADD VALUE 'AVAILABILITY_REQUEST';
ALTER TYPE "ObservationType" ADD VALUE 'DELIVERY_TIME_REQUEST';
ALTER TYPE "ObservationType" ADD VALUE 'PAYMENT_METHOD_REQUEST';
ALTER TYPE "ObservationType" ADD VALUE 'PRICE_OBJECTION';
ALTER TYPE "ObservationType" ADD VALUE 'AVAILABILITY_FRICTION';
ALTER TYPE "ObservationType" ADD VALUE 'DELIVERY_LOCATION_FRICTION';
ALTER TYPE "ObservationType" ADD VALUE 'INSTALLATION_FRICTION';
ALTER TYPE "ObservationType" ADD VALUE 'TRUST_FRICTION';
ALTER TYPE "ObservationType" ADD VALUE 'TIMING_FRICTION';
ALTER TYPE "ObservationType" ADD VALUE 'LIMA_MENTIONED';
ALTER TYPE "ObservationType" ADD VALUE 'PROVINCE_MENTIONED';

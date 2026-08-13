-- CreateEnum
CREATE TYPE "SemanticAnalysisStatus" AS ENUM ('NOT_EVALUATED', 'NOT_NEEDED', 'PENDING', 'COMPLETED');

-- AlterTable
ALTER TABLE "imported_conversations" ADD COLUMN     "semanticAnalysisStatus" "SemanticAnalysisStatus" NOT NULL DEFAULT 'NOT_EVALUATED';

-- AlterTable
ALTER TABLE "website_pages" ADD COLUMN     "semanticAnalysisStatus" "SemanticAnalysisStatus" NOT NULL DEFAULT 'NOT_EVALUATED';

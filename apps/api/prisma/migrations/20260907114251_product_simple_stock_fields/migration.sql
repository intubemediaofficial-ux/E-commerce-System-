-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "currentStock" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "stockDate" DATE,
ADD COLUMN     "warehouseName" TEXT;

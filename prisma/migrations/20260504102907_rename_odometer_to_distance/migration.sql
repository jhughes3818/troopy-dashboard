/*
  Warnings:

  - You are about to drop the column `odometerKm` on the `FuelLog` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "FuelLog" DROP COLUMN "odometerKm",
ADD COLUMN     "distanceKm" DOUBLE PRECISION;

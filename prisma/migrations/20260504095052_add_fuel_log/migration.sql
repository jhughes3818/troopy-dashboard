-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "isFull" BOOLEAN NOT NULL DEFAULT false,
    "odometerKm" DOUBLE PRECISION,
    "pricePerL" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelLog_filledAt_idx" ON "FuelLog"("filledAt" ASC);

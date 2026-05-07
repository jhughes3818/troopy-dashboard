-- CreateTable
CREATE TABLE "WaterLog" (
    "id" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaterLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaterLog_filledAt_idx" ON "WaterLog"("filledAt" ASC);

-- CreateTable
CREATE TABLE "TelemetryReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "voltage" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "soc" DOUBLE PRECISION,
    "power" DOUBLE PRECISION,
    "auxVoltage" DOUBLE PRECISION,
    "ttgDays" DOUBLE PRECISION,
    "timestampMs" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TelemetryReading_receivedAt_idx" ON "TelemetryReading"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "TelemetryReading_deviceId_receivedAt_idx" ON "TelemetryReading"("deviceId", "receivedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryReading_deviceId_timestampMs_key" ON "TelemetryReading"("deviceId", "timestampMs");

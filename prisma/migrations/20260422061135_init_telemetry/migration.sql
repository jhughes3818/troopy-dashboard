-- CreateTable
CREATE TABLE "TelemetryReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "voltage" REAL,
    "current" REAL,
    "soc" REAL,
    "power" REAL,
    "auxVoltage" REAL,
    "ttgDays" REAL,
    "timestampMs" BIGINT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TelemetryReading_receivedAt_idx" ON "TelemetryReading"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "TelemetryReading_deviceId_receivedAt_idx" ON "TelemetryReading"("deviceId", "receivedAt" DESC);

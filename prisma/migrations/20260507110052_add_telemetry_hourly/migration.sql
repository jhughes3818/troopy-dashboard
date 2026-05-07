-- CreateTable
CREATE TABLE "TelemetryHourly" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "voltage" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "soc" DOUBLE PRECISION,
    "power" DOUBLE PRECISION,
    "auxVoltage" DOUBLE PRECISION,
    "ttgDays" DOUBLE PRECISION,
    "insideTempC" DOUBLE PRECISION,
    "outsideTempC" DOUBLE PRECISION,
    "fridgeTempC" DOUBLE PRECISION,
    "gpsLatitude" DOUBLE PRECISION,
    "gpsLongitude" DOUBLE PRECISION,
    "gpsSpeedKmph" DOUBLE PRECISION,
    "waterFlowMlMin" DOUBLE PRECISION,
    "socMin" DOUBLE PRECISION,
    "voltageMin" DOUBLE PRECISION,
    "waterCumulativeMl" DOUBLE PRECISION,
    "sampleCount" INTEGER NOT NULL,

    CONSTRAINT "TelemetryHourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelemetryHourly_deviceId_hourBucket_idx" ON "TelemetryHourly"("deviceId", "hourBucket" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryHourly_deviceId_hourBucket_key" ON "TelemetryHourly"("deviceId", "hourBucket");

-- CreateTable
CREATE TABLE "WeatherReading" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "windSpeedKmh" DOUBLE PRECISION,
    "windDirectionDeg" DOUBLE PRECISION,
    "windGustKmh" DOUBLE PRECISION,
    "temperatureC" DOUBLE PRECISION,
    "apparentTemperatureC" DOUBLE PRECISION,
    "precipitationMm" DOUBLE PRECISION,
    "cloudCoverPercent" DOUBLE PRECISION,
    "pressureHpa" DOUBLE PRECISION,
    "source" TEXT,
    "sourceTimestampMs" BIGINT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherReading_fetchedAt_idx" ON "WeatherReading"("fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "WeatherReading_deviceId_fetchedAt_idx" ON "WeatherReading"("deviceId", "fetchedAt" DESC);

-- CreateIndex
CREATE INDEX "WeatherReading_deviceId_sourceTimestampMs_idx" ON "WeatherReading"("deviceId", "sourceTimestampMs" DESC);

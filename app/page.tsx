import { Clock, Gauge, Power, MapPin, BookOpen, Fuel, Route } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { serializeReadings } from "@/lib/telemetry";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { BatteryChart } from "./components/battery-chart";
import { DailyStatsSection } from "./components/daily-stats-section";
import { TEST_MODE, MOCK_FUEL_LOGS, MOCK_VEHICLE_PROFILE } from "@/lib/test-mode";

const HISTORY_LIMIT = 50000;
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function computeGpsDistanceKm(startMs: number, endMs: number): Promise<number | null> {
  const readings = await prisma.telemetryReading.findMany({
    where: {
      gpsValid: true,
      gpsLatitude: { not: null },
      gpsLongitude: { not: null },
      timestampMs: { gte: BigInt(Math.floor(startMs)), lte: BigInt(Math.floor(endMs)) },
    },
    orderBy: { timestampMs: "asc" },
    select: { gpsLatitude: true, gpsLongitude: true },
  });

  if (readings.length < 2) return null;
  let total = 0;
  let hasDistance = false;
  let prev: { gpsLatitude: number; gpsLongitude: number } | null = null;
  for (const r of readings) {
    if (r.gpsLatitude === null || r.gpsLongitude === null) continue;
    if (prev) {
      const d = haversineKm(prev.gpsLatitude, prev.gpsLongitude, r.gpsLatitude, r.gpsLongitude);
      if (d >= 0.02 && d < 5) { total += d; hasDistance = true; }
    }
    prev = r as { gpsLatitude: number; gpsLongitude: number };
  }
  return hasDistance ? total : null;
}

type FuelEstimate = {
  tankCapacityL: number;
  distanceSinceLastFullKm: number;
  economyL100km: number;
  remainingFuelL: number;
  estimatedRangeKm: number;
};

async function fetchFuelEstimate(): Promise<FuelEstimate | null> {
  if (TEST_MODE) {
    const logs = [...MOCK_FUEL_LOGS];
    const fullFillUps = logs.filter((e) => e.isFull);
    if (fullFillUps.length < 2) return null;
    const startFull = fullFillUps[fullFillUps.length - 2];
    const endFull = fullFillUps[fullFillUps.length - 1];
    const segmentEntries = logs.filter(
      (e) => e.filledAt > startFull.filledAt && e.filledAt <= endFull.filledAt,
    );
    const segmentLitres = segmentEntries.reduce((sum, e) => sum + e.litres, 0);
    const segmentDistanceKm = segmentEntries.every((e) => e.distanceKm !== null)
      ? segmentEntries.reduce((sum, e) => sum + (e.distanceKm as number), 0)
      : 0;
    const economyL100km = (segmentLitres / segmentDistanceKm) * 100;
    const entriesAfterLastFull = logs.filter((e) => e.filledAt > endFull.filledAt);
    const distanceSinceLastFullKm =
      entriesAfterLastFull.length > 0 && entriesAfterLastFull.every((e) => e.distanceKm !== null)
        ? entriesAfterLastFull.reduce((sum, e) => sum + (e.distanceKm as number), 0)
        : 0;
    const fuelConsumedL = (distanceSinceLastFullKm * economyL100km) / 100;
    const remainingFuelL = Math.max(0, MOCK_VEHICLE_PROFILE.tankCapacityL - fuelConsumedL);
    return {
      tankCapacityL: MOCK_VEHICLE_PROFILE.tankCapacityL,
      distanceSinceLastFullKm,
      economyL100km,
      remainingFuelL,
      estimatedRangeKm: (remainingFuelL / economyL100km) * 100,
    };
  }

  const [vehicleProfile, fullFillUps] = await Promise.all([
    prisma.vehicleProfile.findUnique({ where: { id: "vehicle" } }),
    prisma.fuelLog.findMany({ where: { isFull: true }, orderBy: { filledAt: "asc" } }),
  ]);

  if (!vehicleProfile || fullFillUps.length < 2) return null;

  const startFull = fullFillUps[fullFillUps.length - 2];
  const endFull = fullFillUps[fullFillUps.length - 1];

  const segmentEntries = await prisma.fuelLog.findMany({
    where: { filledAt: { gt: startFull.filledAt, lte: endFull.filledAt } },
  });
  const totalLitresForSegment = segmentEntries.reduce((sum, e) => sum + e.litres, 0);

  const segmentDistanceKm = segmentEntries.every((e) => e.distanceKm !== null)
    ? segmentEntries.reduce((sum, e) => sum + (e.distanceKm as number), 0)
    : await computeGpsDistanceKm(startFull.filledAt.getTime(), endFull.filledAt.getTime());
  if (!segmentDistanceKm || segmentDistanceKm <= 0) return null;

  const economyL100km = (totalLitresForSegment / segmentDistanceKm) * 100;

  // Sum distanceKm entries after last full; fall back to GPS if none have it
  const entriesAfterLastFull = await prisma.fuelLog.findMany({
    where: { filledAt: { gt: endFull.filledAt } },
    orderBy: { filledAt: "asc" },
  });

  const distanceSinceLastFullKm =
    entriesAfterLastFull.length > 0 && entriesAfterLastFull.every((e) => e.distanceKm !== null)
      ? entriesAfterLastFull.reduce((sum, e) => sum + (e.distanceKm as number), 0)
      : (await computeGpsDistanceKm(endFull.filledAt.getTime(), Date.now())) ?? 0;

  const fuelConsumedL = (distanceSinceLastFullKm * economyL100km) / 100;
  const remainingFuelL = Math.max(0, vehicleProfile.tankCapacityL - fuelConsumedL);
  const estimatedRangeKm = economyL100km > 0 ? (remainingFuelL / economyL100km) * 100 : 0;

  return { tankCapacityL: vehicleProfile.tankCapacityL, distanceSinceLastFullKm, economyL100km, remainingFuelL, estimatedRangeKm };
}

async function fetchReadings() {
  const oneWeekAgoMs = BigInt(Date.now() - HISTORY_WINDOW_MS);
  return prisma.telemetryReading.findMany({
    where: { timestampMs: { gte: oneWeekAgoMs } },
    orderBy: { timestampMs: "desc" },
    take: HISTORY_LIMIT,
  });
}

function formatNullable(value: number | null, digits = 2) {
  if (value === null) return "-";
  return value.toFixed(digits);
}

function formatSampleTime(value: bigint | number | string | null) {
  if (value === null) return "-";
  const date = new Date(Number(value));
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatSampleDate(value: bigint | number | string | null) {
  if (value === null) return "-";
  const date = new Date(Number(value));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatHeaderDateTime(value: bigint | number | string | null) {
  if (value === null) return { time: "-", date: "-" };
  return {
    time: formatSampleTime(value),
    date: formatSampleDate(value),
  };
}

function formatTTG(days: number | null, current: number | null) {
  if (days === null) return "-";
  if (current !== null && current > 0) return "Charging";

  const totalHours = days * 24;
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);

  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    return `${d}d ${h}h`;
  }

  return `${hours}h ${minutes}m`;
}

const primaryCardClassName =
  "rounded-[28px] border border-zinc-800/70 bg-zinc-900/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm";

export default async function Home() {
  const [readings, fuelEstimate] = await Promise.all([fetchReadings(), fetchFuelEstimate()]);

  const serializedReadings = serializeReadings(readings);
  const latest = serializedReadings[0] ?? null;

  const dailyStatsReadings = serializedReadings.map((r) => ({
    timestampMs: Number(r.timestampMs),
    gpsLatitude: r.gpsLatitude,
    gpsLongitude: r.gpsLongitude,
    gpsValid: r.gpsValid,
    gpsSpeedKmph: r.gpsSpeedKmph,
    insideTemperature: r.insideTemperature,
    outsideTemperature: r.outsideTemperature,
    soc: r.soc,
  }));

  const sampleTimestamp = latest ? latest.timestampMs : null;
  const headerDateTime = formatHeaderDateTime(sampleTimestamp);
  const latestInsideTemperature = latest?.insideTemperature ?? null;
  const latestOutsideTemperature = latest?.outsideTemperature ?? null;
  const latestGpsLatitude = latest?.gpsLatitude ?? null;
  const latestGpsLongitude = latest?.gpsLongitude ?? null;
  const hasLastPosition =
    latestGpsLatitude !== null && latestGpsLongitude !== null;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AutoRefresh intervalMs={15000} />

      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Battery Monitor
            </h1>
            <p className="mt-1 text-base text-zinc-500">
              {latest?.deviceId ?? "troopy-smartshunt"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/logbook"
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800/60 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Logbook
            </Link>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Clock className="h-4 w-4" />
              <span>{headerDateTime.time}</span>
              <span className="text-zinc-700">·</span>
              <span>{headerDateTime.date}</span>
            </div>
          </div>
        </header>

        {/* Chart — primary view */}
        <section className="mb-4">
          <BatteryChart
            data={serializedReadings}
            soc={latest?.soc ?? null}
            current={latest?.current ?? null}
            insideTemperature={latestInsideTemperature}
            outsideTemperature={latestOutsideTemperature}
          />
        </section>

        {/* Daily stats */}
        <section className="mb-4">
          <DailyStatsSection readings={dailyStatsReadings} />
        </section>

        {/* Fuel estimate */}
        {fuelEstimate && (
          <section className="mb-4">
            <Card className={primaryCardClassName}>
              <CardContent className="p-5 md:p-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                      <Fuel className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium uppercase tracking-[0.16em]">Est. Remaining</span>
                    </div>
                    <div className="text-2xl font-semibold tracking-tight tabular-nums text-amber-400">
                      {fuelEstimate.remainingFuelL.toFixed(0)}
                      <span className="ml-1.5 text-sm font-normal text-zinc-500">L</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                      <Route className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium uppercase tracking-[0.16em]">Est. Range</span>
                    </div>
                    <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200">
                      {fuelEstimate.estimatedRangeKm.toFixed(0)}
                      <span className="ml-1.5 text-sm font-normal text-zinc-500">km</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                      <Gauge className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium uppercase tracking-[0.16em]">Economy</span>
                    </div>
                    <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200">
                      {fuelEstimate.economyL100km.toFixed(1)}
                      <span className="ml-1.5 text-sm font-normal text-zinc-500">L/100km</span>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                      <Route className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium uppercase tracking-[0.16em]">Since Fill-up</span>
                    </div>
                    <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200">
                      {fuelEstimate.distanceSinceLastFullKm.toFixed(0)}
                      <span className="ml-1.5 text-sm font-normal text-zinc-500">km</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Secondary stats */}
        <section className="mb-4">
          <Card className={primaryCardClassName}>
            <CardContent className="p-5 md:p-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                    <Gauge className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-[0.16em]">Voltage</span>
                  </div>
                  <div className="text-2xl font-semibold tracking-tight tabular-nums text-sky-400">
                    {formatNullable(latest?.voltage ?? null)}
                    <span className="ml-1.5 text-sm text-zinc-500">V</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                    <Power className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-[0.16em]">Power</span>
                  </div>
                  <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200">
                    {formatNullable(latest?.power ?? null, 1)}
                    <span className="ml-1.5 text-sm text-zinc-500">W</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-[0.16em]">Time to Go</span>
                  </div>
                  <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200">
                    {formatTTG(latest?.ttgDays ?? null, latest?.current ?? null)}
                  </div>
                </div>

                {hasLastPosition ? (
                  <div>
                    <div className="mb-1 flex items-center gap-1.5 text-zinc-500">
                      <MapPin className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium uppercase tracking-[0.16em]">Location</span>
                    </div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${latestGpsLatitude},${latestGpsLongitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-sky-400 hover:text-sky-300"
                    >
                      Open in Maps
                    </a>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

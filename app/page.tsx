import { prisma } from "@/lib/prisma";
import { serializeReadings } from "@/lib/telemetry";
import { unstable_cache } from "next/cache";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { SwipeDashboard } from "@/app/components/swipe-dashboard";

const RAW_WINDOW_MS = 24 * 60 * 60 * 1000;
const GPS_HISTORY_DAYS = 7;
const WATER_TANK_L = 45;
const MOTION_THRESHOLD_KMPH = 5;

export const dynamic = "force-dynamic";

const fetchRawReadings = unstable_cache(
  async () => {
    const oneDayAgoMs = BigInt(Date.now() - RAW_WINDOW_MS);
    const readings = await prisma.telemetryReading.findMany({
      where: { timestampMs: { gte: oneDayAgoMs } },
      orderBy: { timestampMs: "desc" },
      take: 2000,
      omit: {
        gpsAltitudeM: true,
        gpsCourseDeg: true,
        gpsSatellites: true,
        gpsHdop: true,
        gpsFixAgeMs: true,
        receivedAt: true,
      },
    });
    return serializeReadings(readings);
  },
  ["raw-readings"],
  { revalidate: 60 },
);

const fetchWaterEstimate = unstable_cache(
  async (): Promise<{ remainingL: number; remainingPct: number } | null> => {
    const lastFill = await prisma.waterLog.findFirst({ orderBy: { filledAt: "desc" } });
    if (!lastFill) return null;

    if (lastFill.waterSnapshotMl !== null) {
      const latestStationary = await prisma.telemetryReading.findFirst({
        where: {
          timestampMs: { gte: BigInt(lastFill.filledAt.getTime()) },
          waterCumulativeMl: { not: null },
          OR: [{ gpsSpeedKmph: null }, { gpsSpeedKmph: { lte: MOTION_THRESHOLD_KMPH } }],
        },
        orderBy: { timestampMs: "desc" },
        select: { waterCumulativeMl: true },
      });

      const waterUsedMl =
        latestStationary?.waterCumulativeMl != null
          ? Math.max(0, latestStationary.waterCumulativeMl - lastFill.waterSnapshotMl)
          : 0;
      const remainingL = Math.max(0, WATER_TANK_L - waterUsedMl / 1000);
      return { remainingL, remainingPct: (remainingL / WATER_TANK_L) * 100 };
    }

    const readings = await prisma.telemetryReading.findMany({
      where: {
        timestampMs: { gte: BigInt(lastFill.filledAt.getTime()) },
        waterCumulativeMl: { not: null },
      },
      orderBy: { timestampMs: "asc" },
      select: { waterCumulativeMl: true, gpsSpeedKmph: true },
    });

    let waterUsedMl = 0;
    let prevStationary: number | null = null;

    for (const r of readings) {
      if (r.waterCumulativeMl === null) continue;
      const isStationary =
        r.gpsSpeedKmph === null || r.gpsSpeedKmph <= MOTION_THRESHOLD_KMPH;
      if (isStationary) {
        if (prevStationary !== null) {
          const delta = r.waterCumulativeMl - prevStationary;
          if (delta > 0) waterUsedMl += delta;
        }
        prevStationary = r.waterCumulativeMl;
      } else {
        prevStationary = null;
      }
    }

    const remainingL = Math.max(0, WATER_TANK_L - waterUsedMl / 1000);
    return { remainingL, remainingPct: (remainingL / WATER_TANK_L) * 100 };
  },
  ["water-estimate"],
  { revalidate: 300, tags: ["water-estimate"] },
);

const fetchBatteryHourly = unstable_cache(
  async () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.telemetryHourly.findMany({
      where: { hourBucket: { gte: oneDayAgo } },
      orderBy: { hourBucket: "asc" },
      select: { hourBucket: true, current: true },
    });
    return rows.map((r) => ({
      hourBucket: r.hourBucket.getTime(),
      current: r.current,
    }));
  },
  ["battery-hourly"],
  { revalidate: 300 },
);

const fetchFuelData = unstable_cache(
  async () => {
    const [logs, profile] = await Promise.all([
      prisma.fuelLog.findMany({ orderBy: { filledAt: "desc" }, take: 20 }),
      prisma.vehicleProfile.findFirst(),
    ]);
    return {
      logs: logs.map((l) => ({
        id: l.id,
        filledAt: l.filledAt.getTime(),
        litres: l.litres,
        isFull: l.isFull,
        distanceKm: l.distanceKm,
        gpsDistanceKm: l.gpsDistanceKm,
        pricePerL: l.pricePerL,
        notes: l.notes,
      })),
      tankCapacityL: profile?.tankCapacityL ?? null,
    };
  },
  ["fuel-data"],
  { revalidate: 300 },
);

const fetchGpsHistory = unstable_cache(
  async () => {
    const cutoffMs = BigInt(Date.now() - GPS_HISTORY_DAYS * 24 * 60 * 60 * 1000);
    const rows = await prisma.telemetryReading.findMany({
      where: { timestampMs: { gte: cutoffMs } },
      orderBy: { timestampMs: "asc" },
      select: { timestampMs: true, gpsSpeedKmph: true },
    });
    return rows.map((r) => ({
      timestampMs: Number(r.timestampMs),
      gpsSpeedKmph: r.gpsSpeedKmph,
    }));
  },
  ["gps-history"],
  { revalidate: 300 },
);

const fetchWaterHourly = unstable_cache(
  async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await prisma.telemetryHourly.findMany({
      where: { hourBucket: { gte: sevenDaysAgo }, waterCumulativeMl: { not: null } },
      orderBy: { hourBucket: "asc" },
      select: { hourBucket: true, waterCumulativeMl: true },
    });
    return rows.map((r) => ({
      timestampMs: r.hourBucket.getTime(),
      waterCumulativeMl: r.waterCumulativeMl as number,
    }));
  },
  ["water-hourly"],
  { revalidate: 300 },
);

function computeWaterDailyUsage(
  hourly: { timestampMs: number; waterCumulativeMl: number }[],
): { date: string; usedL: number }[] {
  const byDay = new Map<string, number>();
  // Seed every day that has hourly data so zero-usage days still appear
  for (const r of hourly) {
    const day = new Date(r.timestampMs).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, 0);
  }
  for (let i = 1; i < hourly.length; i++) {
    const delta = hourly[i].waterCumulativeMl - hourly[i - 1].waterCumulativeMl;
    if (delta <= 0) continue; // skip counter resets / device restarts
    const day = new Date(hourly[i].timestampMs).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + delta);
  }
  return Array.from(byDay.entries())
    .map(([date, usedMl]) => ({ date, usedL: usedMl / 1000 }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);
}

export default async function Home() {
  const [rawReadings, waterEstimate, waterHourly, batteryHourly, fuelData, gpsHistory] = await Promise.all([
    fetchRawReadings(),
    fetchWaterEstimate(),
    fetchWaterHourly(),
    fetchBatteryHourly(),
    fetchFuelData(),
    fetchGpsHistory(),
  ]);

  const latest = rawReadings[0] ?? null;
  const waterDailyUsage = computeWaterDailyUsage(waterHourly);

  return (
    <main>
      <AutoRefresh intervalMs={30000} />
      <SwipeDashboard
        readings={rawReadings}
        latest={latest}
        deviceId={latest?.deviceId ?? null}
        waterRemainingL={waterEstimate?.remainingL ?? null}
        waterRemainingPct={waterEstimate?.remainingPct ?? null}
        waterTankL={WATER_TANK_L}
        waterDailyUsage={waterDailyUsage}
        batteryHourly={batteryHourly}
        fuelLogs={fuelData.logs}
        fuelTankCapacityL={fuelData.tankCapacityL}
        gpsHistory={gpsHistory}
      />
    </main>
  );
}

import { prisma } from "@/lib/prisma";
import { ArrowLeft, Fuel } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { AddFuelLogForm } from "./components/add-fuel-log-form";
import { DeleteFuelLogButton } from "./components/delete-fuel-log-button";
import { TankCapacityForm } from "./components/tank-capacity-form";
import { TEST_MODE, MOCK_FUEL_LOGS, MOCK_VEHICLE_PROFILE } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

type FuelLogEntry = {
  id: string;
  filledAt: Date;
  litres: number;
  isFull: boolean;
  distanceKm: number | null;
  pricePerL: number | null;
  notes: string | null;
};

type Segment = {
  startEntry: FuelLogEntry;
  endEntry: FuelLogEntry;
  totalLitres: number;
  odoDistanceKm: number | null;
  gpsDistanceKm: number | null;
  distanceKm: number | null;
  gpsAccuracyPct: number | null;
  totalCost: number | null;
  economyL100km: number | null;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function computeGpsDistance(startMs: number, endMs: number): Promise<number | null> {
  if (TEST_MODE) return null;
  const readings = await prisma.telemetryReading.findMany({
    where: {
      gpsValid: true,
      gpsLatitude: { not: null },
      gpsLongitude: { not: null },
      timestampMs: {
        gte: BigInt(Math.floor(startMs)),
        lte: BigInt(Math.floor(endMs)),
      },
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
    if (prev !== null) {
      const d = haversineKm(prev.gpsLatitude, prev.gpsLongitude, r.gpsLatitude, r.gpsLongitude);
      if (d >= 0.02 && d < 5) {
        total += d;
        hasDistance = true;
      }
    }
    prev = r as { gpsLatitude: number; gpsLongitude: number };
  }

  return hasDistance ? total : null;
}

async function buildSegments(entries: FuelLogEntry[]): Promise<Segment[]> {
  const fullEntries = entries.filter((e) => e.isFull);
  if (fullEntries.length < 2) return [];

  const segments: Segment[] = [];

  for (let i = 0; i < fullEntries.length - 1; i++) {
    const start = fullEntries[i];
    const end = fullEntries[i + 1];

    // All fill-ups strictly after start up to and including end
    const segmentEntries = entries.filter(
      (e) => e.filledAt > start.filledAt && e.filledAt <= end.filledAt,
    );

    const totalLitres = segmentEntries.reduce((sum, e) => sum + e.litres, 0);

    // Sum distanceKm values for all entries in the segment; only use if every entry has one
    const odoDistanceKm = segmentEntries.every((e) => e.distanceKm !== null)
      ? segmentEntries.reduce((sum, e) => sum + (e.distanceKm as number), 0)
      : null;

    const gpsDistanceKm = await computeGpsDistance(
      start.filledAt.getTime(),
      end.filledAt.getTime(),
    );

    const distanceKm = odoDistanceKm ?? gpsDistanceKm;

    const gpsAccuracyPct =
      odoDistanceKm !== null && gpsDistanceKm !== null && odoDistanceKm > 0
        ? Math.abs((gpsDistanceKm - odoDistanceKm) / odoDistanceKm) * 100
        : null;

    const totalCost = segmentEntries.reduce<number | null>((sum, e) => {
      if (e.pricePerL === null) return sum;
      return (sum ?? 0) + e.litres * e.pricePerL;
    }, null);

    const economyL100km =
      distanceKm !== null && distanceKm > 0 ? (totalLitres / distanceKm) * 100 : null;

    segments.push({
      startEntry: start,
      endEntry: end,
      totalLitres,
      odoDistanceKm,
      gpsDistanceKm,
      distanceKm,
      gpsAccuracyPct,
      totalCost,
      economyL100km,
    });
  }

  return segments;
}

function fmt(v: number | null, digits = 1) {
  return v === null ? "-" : v.toFixed(digits);
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateShort(d: Date) {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function fmtDateTime(d: Date) {
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const cardClass =
  "rounded-[28px] border border-zinc-800/60 bg-zinc-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-sm";

export default async function LogbookPage() {
  const [entries, vehicleProfile] = TEST_MODE
    ? [[...MOCK_FUEL_LOGS], MOCK_VEHICLE_PROFILE]
    : await Promise.all([
        prisma.fuelLog.findMany({ orderBy: { filledAt: "asc" } }),
        prisma.vehicleProfile.findUnique({ where: { id: "vehicle" } }),
      ]);
  const segments = await buildSegments(entries);

  // Entries that fall after the last full fill-up (not yet part of a closed segment)
  const lastFull = [...entries].reverse().find((e) => e.isFull);
  const pendingEntries = lastFull
    ? entries.filter((e) => e.filledAt > lastFull.filledAt)
    : entries;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/"
            className="rounded-full p-2 text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Fuel className="h-5 w-5 text-zinc-400" />
            <h1 className="text-2xl font-semibold tracking-tight">Logbook</h1>
          </div>
        </header>

        {/* Segments */}
        {segments.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
              Fuel Economy
            </h2>
            <Card className={cardClass}>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800/60">
                        <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Period
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Distance
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Fuel
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Economy
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Cost
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          GPS Δ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {segments.map((seg, i) => (
                        <tr
                          key={i}
                          className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/20"
                        >
                          <td className="px-5 py-4 text-zinc-300">
                            <span className="tabular-nums">
                              {fmtDateShort(seg.startEntry.filledAt)}
                            </span>
                            <span className="mx-1.5 text-zinc-600">→</span>
                            <span className="tabular-nums">
                              {fmtDateShort(seg.endEntry.filledAt)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums text-zinc-200">
                            {seg.distanceKm !== null ? (
                              <>
                                {fmt(seg.distanceKm, 0)}
                                <span className="ml-1 text-zinc-500">km</span>
                                {seg.odoDistanceKm !== null && (
                                  <span className="ml-1.5 text-xs text-zinc-600">odo</span>
                                )}
                              </>
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums text-zinc-200">
                            {fmt(seg.totalLitres, 1)}
                            <span className="ml-1 text-zinc-500">L</span>
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums">
                            {seg.economyL100km !== null ? (
                              <span className="font-medium text-amber-400">
                                {fmt(seg.economyL100km, 1)}
                                <span className="ml-1 text-xs font-normal text-zinc-500">
                                  L/100km
                                </span>
                              </span>
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums text-zinc-200">
                            {seg.totalCost !== null ? (
                              <>
                                ${fmt(seg.totalCost, 2)}
                              </>
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums">
                            {seg.gpsAccuracyPct !== null ? (
                              <span
                                className={
                                  seg.gpsAccuracyPct < 5
                                    ? "text-emerald-400"
                                    : seg.gpsAccuracyPct < 15
                                      ? "text-amber-400"
                                      : "text-red-400"
                                }
                              >
                                {fmt(seg.gpsAccuracyPct, 1)}%
                              </span>
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* All entries */}
        {entries.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
              Fill-up History
            </h2>
            <Card className={cardClass}>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800/60">
                        <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Date
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Litres
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Dist. Since Last Fill
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Price/L
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                          Notes
                        </th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...entries].reverse().map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/20"
                        >
                          <td className="px-5 py-3.5 text-zinc-300">
                            <div className="flex items-center gap-2">
                              <span className="tabular-nums">{fmtDateTime(entry.filledAt)}</span>
                              {entry.isFull && (
                                <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-xs font-medium text-amber-400">
                                  Full
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-zinc-200">
                            {fmt(entry.litres, 1)}
                            <span className="ml-1 text-zinc-500">L</span>
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-zinc-400">
                            {entry.distanceKm !== null ? (
                              <>
                                {fmt(entry.distanceKm, 0)}
                                <span className="ml-1 text-zinc-600">km</span>
                              </>
                            ) : (
                              <span className="text-zinc-700">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-zinc-400">
                            {entry.pricePerL !== null ? (
                              <>${fmt(entry.pricePerL, 3)}</>
                            ) : (
                              <span className="text-zinc-700">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-zinc-500">
                            {entry.notes ?? ""}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <DeleteFuelLogButton id={entry.id} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Add fill-up form */}
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Log Fill-up
          </h2>
          <Card className={cardClass}>
            <CardContent className="p-5 md:p-6">
              <AddFuelLogForm />
            </CardContent>
          </Card>
        </section>

        {/* Vehicle settings */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Vehicle Settings
          </h2>
          <Card className={cardClass}>
            <CardContent className="p-5 md:p-6">
              <TankCapacityForm currentCapacity={vehicleProfile?.tankCapacityL ?? null} />
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

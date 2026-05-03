import {
  Battery,
  Zap,
  Activity,
  Clock,
  Gauge,
  Power,
  Thermometer,
  MapPin,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { serializeReadings } from "@/lib/telemetry";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { BatteryChart } from "./components/battery-chart";
import { LocalSampleTime } from "./components/local-sample-time";
import { DailyStatsSection } from "./components/daily-stats-section";

const HISTORY_LIMIT = 50000;
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

async function fetchReadings() {
  const oneWeekAgoMs = BigInt(Date.now() - HISTORY_WINDOW_MS);
  return prisma.telemetryReading.findMany({
    where: { timestampMs: { gte: oneWeekAgoMs } },
    orderBy: { timestampMs: "desc" },
    take: HISTORY_LIMIT,
  });
}

function getSocTextColor(soc: number | null) {
  if (soc === null) return "text-zinc-400";
  if (soc >= 80) return "text-emerald-400";
  if (soc >= 50) return "text-amber-400";
  if (soc >= 20) return "text-orange-400";
  return "text-red-400";
}

function getSocBarColor(soc: number | null) {
  if (soc === null) return "bg-zinc-600";
  if (soc >= 80) return "bg-emerald-500";
  if (soc >= 50) return "bg-amber-500";
  if (soc >= 20) return "bg-orange-500";
  return "bg-red-500";
}

function formatNullable(value: number | null, digits = 2) {
  if (value === null) return "-";
  return value.toFixed(digits);
}

function formatTemperature(value: number | null) {
  if (value === null) return "-";
  return value.toFixed(1);
}

function formatCoordinate(value: number | null) {
  if (value === null) return "-";
  return value.toFixed(6);
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

function formatTTG(days: number | null) {
  if (days === null) return "-";
  if (days <= 0) return "Charging";

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

const secondaryCardClassName =
  "rounded-[28px] border border-zinc-800/60 bg-zinc-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-sm";

export default async function Home() {
  const readings = await fetchReadings();

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

  const isCharging = latest?.current !== null && latest.current > 0;
  const isDischarging = latest?.current !== null && latest.current < 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AutoRefresh intervalMs={15000} />

      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Battery Monitor
            </h1>
            <p className="mt-1 text-base text-zinc-500">
              {latest?.deviceId ?? "troopy-smartshunt"}
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Clock className="h-4 w-4" />
            <span>{headerDateTime.time}</span>
            <span className="text-zinc-700">·</span>
            <span>{headerDateTime.date}</span>
          </div>
        </header>

        <section className="mb-4">
          <Card className={primaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="flex min-h-[280px] flex-col items-center justify-center">
                <div className="mb-4 flex items-center gap-2 text-zinc-500">
                  <Battery className="h-5 w-5" />
                  <span className="text-sm font-medium uppercase tracking-[0.16em]">
                    State of Charge
                  </span>
                </div>

                <div
                  className={`text-7xl font-semibold leading-none tracking-tight tabular-nums md:text-9xl ${getSocTextColor(
                    latest?.soc ?? null,
                  )}`}
                >
                  {latest?.soc !== null && latest?.soc !== undefined
                    ? latest.soc.toFixed(0)
                    : "-"}
                  <span className="text-4xl md:text-6xl">%</span>
                </div>

                <div className="mt-8 h-3 w-full max-w-md overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getSocBarColor(
                      latest?.soc ?? null,
                    )}`}
                    style={{
                      width: `${Math.max(0, Math.min(latest?.soc ?? 0, 100))}%`,
                    }}
                  />
                </div>

                <div className="mt-6 flex items-center gap-2">
                  {isCharging && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-400">
                      <Zap className="h-4 w-4" />
                      Charging
                    </span>
                  )}

                  {isDischarging && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-amber-400">
                      <Activity className="h-4 w-4" />
                      Discharging
                    </span>
                  )}

                  {!isCharging && !isDischarging && (
                    <span className="text-sm font-medium text-zinc-500">
                      Idle
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className={primaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Voltage
                </span>
              </div>

              <div className="text-4xl font-semibold tracking-tight tabular-nums text-sky-400 md:text-5xl">
                {formatNullable(latest?.voltage ?? null)}
                <span className="ml-2 text-2xl text-zinc-500">V</span>
              </div>
            </CardContent>
          </Card>

          <Card className={primaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <Zap className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Current
                </span>
              </div>

              <div
                className={`text-4xl font-semibold tracking-tight tabular-nums md:text-5xl ${
                  (latest?.current ?? 0) >= 0
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                {latest?.current !== null && latest?.current !== undefined
                  ? `${latest.current >= 0 ? "+" : ""}${latest.current.toFixed(2)}`
                  : "-"}
                <span className="ml-2 text-2xl text-zinc-500">A</span>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
          <Card className={secondaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <Power className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Power
                </span>
              </div>

              <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-3xl">
                {formatNullable(latest?.power ?? null, 1)}
                <span className="ml-2 text-base text-zinc-500">W</span>
              </div>
            </CardContent>
          </Card>

          <Card className={secondaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Time to Go
                </span>
              </div>

              <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-3xl">
                {formatTTG(latest?.ttgDays ?? null)}
              </div>
            </CardContent>
          </Card>

          <Card className={secondaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <Thermometer className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Temperature
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-600">
                    Inside
                  </div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-3xl">
                    {formatTemperature(latestInsideTemperature)}
                    <span className="ml-1 text-base text-zinc-500">°C</span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-600">
                    Outside
                  </div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-3xl">
                    {formatTemperature(latestOutsideTemperature)}
                    <span className="ml-1 text-base text-zinc-500">°C</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={secondaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <MapPin className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Last Position
                </span>
              </div>

              {hasLastPosition ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-600">
                      Latitude
                    </div>
                    <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-2xl">
                      {formatCoordinate(latestGpsLatitude)}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-600">
                      Longitude
                    </div>
                    <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-2xl">
                      {formatCoordinate(latestGpsLongitude)}
                    </div>
                  </div>

                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${latestGpsLatitude},${latestGpsLongitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm font-medium text-sky-400 hover:text-sky-300"
                  >
                    Open in Maps
                  </a>
                </div>
              ) : (
                <div className="text-2xl font-semibold tracking-tight text-zinc-500 md:text-3xl">
                  -
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={secondaryCardClassName}>
            <CardContent className="p-6 md:p-8">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <Clock className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-[0.16em]">
                  Sample Time
                </span>
              </div>

              <LocalSampleTime
                timestampMs={
                  sampleTimestamp === null ? null : Number(sampleTimestamp)
                }
              />
            </CardContent>
          </Card>
        </section>

        <section className="mb-4">
          <DailyStatsSection readings={dailyStatsReadings} />
        </section>

        <section className="space-y-4">
          <Card className={secondaryCardClassName}>
            <CardContent className="">
              <BatteryChart data={serializedReadings} />
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

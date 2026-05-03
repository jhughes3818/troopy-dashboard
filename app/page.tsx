import { Clock, Gauge, Power, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { serializeReadings } from "@/lib/telemetry";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { BatteryChart } from "./components/battery-chart";
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

          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Clock className="h-4 w-4" />
            <span>{headerDateTime.time}</span>
            <span className="text-zinc-700">·</span>
            <span>{headerDateTime.date}</span>
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
                    {formatTTG(latest?.ttgDays ?? null)}
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

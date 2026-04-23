import { prisma } from "@/lib/prisma";
import { serializeReadings } from "@/lib/telemetry";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { TelemetryChart } from "@/app/components/telemetry-chart";
import { ClearHistoryButton } from "@/app/components/clear-history-button";

const HISTORY_LIMIT = 5000;

export const dynamic = "force-dynamic";

function formatNullable(value: number | null) {
  if (value === null) return "-";
  return value.toFixed(2);
}

function formatDate(value: Date | string | number) {
  return new Date(value).toLocaleString();
}

function formatTimestampMs(value: bigint | number | string) {
  return new Date(Number(value)).toLocaleString();
}

export default async function Home() {
  const readings = await prisma.telemetryReading.findMany({
    orderBy: { timestampMs: "desc" },
    take: HISTORY_LIMIT,
  });

  const serializedReadings = serializeReadings(readings);
  const latest = serializedReadings[0] ?? null;

  const chartData = [...serializedReadings]
    .reverse()
    .map(({ timestampMs, voltage, current, soc }) => ({
      timestampMs: Number(timestampMs),
      voltage,
      current,
      soc,
    }));

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AutoRefresh intervalMs={5000} />

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Victron Telemetry Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Refreshes every 5 seconds. Showing newest readings first.
          </p>
        </div>
        {process.env.NODE_ENV === "development" ? <ClearHistoryButton /> : null}
      </div>

      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-medium">Latest reading</h2>
        {!latest ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No telemetry yet. Post data to <code>/api/victron</code> to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="font-medium">Device:</span> {latest.deviceId}</div>
            <div><span className="font-medium">Voltage:</span> {formatNullable(latest.voltage)}</div>
            <div><span className="font-medium">Current:</span> {formatNullable(latest.current)}</div>
            <div><span className="font-medium">SOC:</span> {formatNullable(latest.soc)}</div>
            <div><span className="font-medium">Power:</span> {formatNullable(latest.power)}</div>
            <div><span className="font-medium">Aux voltage:</span> {formatNullable(latest.auxVoltage)}</div>
            <div><span className="font-medium">TTG days:</span> {formatNullable(latest.ttgDays)}</div>
            <div><span className="font-medium">Sample time:</span> {formatTimestampMs(latest.timestampMs)}</div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-medium">Telemetry chart</h2>
        <TelemetryChart data={chartData} />
      </section>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-lg font-medium">History</h2>
        {serializedReadings.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No historical readings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-2 py-2">sampleTime</th>
                  <th className="px-2 py-2">deviceId</th>
                  <th className="px-2 py-2">voltage</th>
                  <th className="px-2 py-2">current</th>
                  <th className="px-2 py-2">soc</th>
                  <th className="px-2 py-2">power</th>
                  <th className="px-2 py-2">auxVoltage</th>
                  <th className="px-2 py-2">ttgDays</th>
                  <th className="px-2 py-2">timestampMs</th>
                  <th className="px-2 py-2">receivedAt</th>
                </tr>
              </thead>
              <tbody>
                {serializedReadings.map((reading) => (
                  <tr
                    key={reading.id}
                    className="border-b border-zinc-100 align-top dark:border-zinc-900"
                  >
                    <td className="px-2 py-2 whitespace-nowrap">
                      {formatTimestampMs(reading.timestampMs)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{reading.deviceId}</td>
                    <td className="px-2 py-2">{formatNullable(reading.voltage)}</td>
                    <td className="px-2 py-2">{formatNullable(reading.current)}</td>
                    <td className="px-2 py-2">{formatNullable(reading.soc)}</td>
                    <td className="px-2 py-2">{formatNullable(reading.power)}</td>
                    <td className="px-2 py-2">{formatNullable(reading.auxVoltage)}</td>
                    <td className="px-2 py-2">{formatNullable(reading.ttgDays)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{reading.timestampMs}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(reading.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
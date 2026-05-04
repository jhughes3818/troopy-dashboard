"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TimeRange = "1h" | "3h" | "6h" | "12h" | "24h" | "1w";
type Metric =
  | "voltage"
  | "current"
  | "soc"
  | "insideTemperature"
  | "outsideTemperature"
  | "speed";

type TelemetryReading = {
  timestampMs: number | string | bigint;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power?: number | null;
  auxVoltage?: number | null;
  ttgDays?: number | null;
  insideTemperature?: number | null;
  outsideTemperature?: number | null;
  insideTempC?: number | null;
  outsideTempC?: number | null;
  speed?: number | null;
  gpsSpeed?: number | null;
  gpsSpeedKmph?: number | null;
  speedKph?: number | null;
};

type ChartPoint = {
  time: number;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  insideTemperature: number | null;
  outsideTemperature: number | null;
  speed: number | null;
};

interface BatteryChartProps {
  data: TelemetryReading[];
  soc?: number | null;
  current?: number | null;
  insideTemperature?: number | null;
  outsideTemperature?: number | null;
}

function toTimestampMs(value: number | string | bigint): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return value;
}

function getRangeStart(range: TimeRange): number {
  const now = Date.now();

  switch (range) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "3h":
      return now - 3 * 60 * 60 * 1000;
    case "6h":
      return now - 6 * 60 * 60 * 1000;
    case "12h":
      return now - 12 * 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "1w":
      return now - 7 * 24 * 60 * 60 * 1000;
  }
}

const TICK_INTERVAL_MS: Record<TimeRange, number> = {
  "1h":  10 * 60 * 1000,
  "3h":  30 * 60 * 1000,
  "6h":   1 * 60 * 60 * 1000,
  "12h":  2 * 60 * 60 * 1000,
  "24h":  4 * 60 * 60 * 1000,
  "1w":  24 * 60 * 60 * 1000,
};

function getXAxisTicks(chartData: ChartPoint[], range: TimeRange): number[] {
  if (chartData.length === 0) return [];
  const step = TICK_INTERVAL_MS[range];
  const start = chartData[0].time;
  const end = chartData[chartData.length - 1].time;
  // Shift into local time before snapping so ticks land on local boundaries
  // (e.g. local midnight, local hour), then shift back to UTC ms.
  const tzOffsetMs = new Date().getTimezoneOffset() * 60 * 1000;
  const first = Math.ceil((start - tzOffsetMs) / step) * step + tzOffsetMs;
  const ticks: number[] = [];
  for (let t = first; t <= end; t += step) ticks.push(t);
  return ticks;
}

function formatXAxis(date: Date, range: TimeRange): string {
  switch (range) {
    case "1h":
    case "3h":
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    case "6h":
    case "12h":
    case "24h":
      return date.toLocaleTimeString([], { hour: "numeric" });
    case "1w":
      return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }
}

function formatMetricValue(metric: Metric, value: number | null | undefined) {
  if (value == null) return "-";
  if (metric === "soc") return `${value.toFixed(1)}%`;
  if (metric === "voltage") return `${value.toFixed(2)}V`;
  if (metric === "current") return `${value.toFixed(2)}A`;
  if (metric === "speed") return `${value.toFixed(1)}km/h`;
  return `${value.toFixed(1)}°C`;
}

function normaliseSpeedKph(reading: TelemetryReading): number | null {
  const speed =
    reading.speedKph ??
    reading.gpsSpeedKmph ??
    reading.gpsSpeed ??
    reading.speed ??
    null;

  if (speed == null || !Number.isFinite(speed)) return null;

  return speed;
}

const DOWNSAMPLE_BUCKET_MS: Partial<Record<TimeRange, number>> = {
  "1w": 30 * 60 * 1000,
};

function downsample(points: ChartPoint[], bucketMs: number): ChartPoint[] {
  if (points.length === 0) return points;

  const buckets = new Map<number, ChartPoint[]>();
  for (const point of points) {
    const key = Math.floor(point.time / bucketMs) * bucketMs;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  const avg = (pts: ChartPoint[], get: (p: ChartPoint) => number | null): number | null => {
    const vals = pts.map(get).filter((v): v is number => v !== null && Number.isFinite(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([key, pts]) => ({
      time: key + bucketMs / 2,
      voltage: avg(pts, (p) => p.voltage),
      current: avg(pts, (p) => p.current),
      soc: avg(pts, (p) => p.soc),
      insideTemperature: avg(pts, (p) => p.insideTemperature),
      outsideTemperature: avg(pts, (p) => p.outsideTemperature),
      speed: avg(pts, (p) => p.speed),
    }));
}

function smoothSpeedSeries(points: ChartPoint[]): ChartPoint[] {
  const stationaryThresholdKph = 1.5;
  const smoothingWindow = 5;

  return points.map((point, index) => {
    if (point.speed == null) return point;

    const windowStart = Math.max(0, index - smoothingWindow + 1);
    const recentSpeeds = points
      .slice(windowStart, index + 1)
      .map((candidate) => candidate.speed)
      .filter(
        (speed): speed is number => speed != null && Number.isFinite(speed),
      );

    if (!recentSpeeds.length) return point;

    const averageSpeed =
      recentSpeeds.reduce((sum, speed) => sum + speed, 0) / recentSpeeds.length;

    return {
      ...point,
      speed: averageSpeed < stationaryThresholdKph ? 0 : averageSpeed,
    };
  });
}

const metricConfig: Record<Metric, { color: string; label: string; yAxisId: string }> = {
  voltage: { color: "#38bdf8", label: "Voltage (V)", yAxisId: "voltage" },
  current: { color: "#a3e635", label: "Current (A)", yAxisId: "current" },
  soc: { color: "#f97316", label: "SOC (%)", yAxisId: "soc" },
  insideTemperature: { color: "#e879f9", label: "Inside Temp (°C)", yAxisId: "temperature" },
  outsideTemperature: { color: "#facc15", label: "Outside Temp (°C)", yAxisId: "temperature" },
  speed: { color: "#22c55e", label: "Speed (km/h)", yAxisId: "speed" },
};

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey: Metric; value: number | null; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length || label == null) return null;

  const date = new Date(label);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-lg">
      <p className="mb-2 text-xs text-zinc-400">
        {date.toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
        {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </p>

      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-zinc-400">{metricConfig[entry.dataKey]?.label ?? entry.dataKey}:</span>
          <span className="font-medium tabular-nums text-white">
            {formatMetricValue(entry.dataKey, entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function BatteryChart({
  data,
  soc,
  current,
  insideTemperature,
  outsideTemperature,
}: BatteryChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("6h");
  const [activeMetrics, setActiveMetrics] = useState<Metric[]>([
    "soc",
    "insideTemperature",
    "outsideTemperature",
  ]);

  const timeRangeOptions: Array<{ value: TimeRange; label: string }> = [
    { value: "1h", label: "1 hour" },
    { value: "3h", label: "3 hours" },
    { value: "6h", label: "6 hours" },
    { value: "12h", label: "12 hours" },
    { value: "24h", label: "24 hours" },
    { value: "1w", label: "1 week" },
  ];

  const chartData = useMemo<ChartPoint[]>(() => {
    const rangeStart = getRangeStart(timeRange);

    const sortedPoints = [...data]
      .map((reading) => ({
        time: toTimestampMs(reading.timestampMs),
        voltage: reading.voltage,
        current: reading.current,
        soc: reading.soc,
        insideTemperature:
          reading.insideTemperature ?? reading.insideTempC ?? null,
        outsideTemperature:
          reading.outsideTemperature ?? reading.outsideTempC ?? null,
        speed: normaliseSpeedKph(reading),
      }))
      .filter(
        (point) => Number.isFinite(point.time) && point.time >= rangeStart,
      )
      .sort((a, b) => a.time - b.time);

    const smoothed = smoothSpeedSeries(sortedPoints);
    const bucketMs = DOWNSAMPLE_BUCKET_MS[timeRange];
    return bucketMs ? downsample(smoothed, bucketMs) : smoothed;
  }, [data, timeRange]);

  const toggleMetric = (metric: Metric) => {
    setActiveMetrics((prev) => {
      if (prev.includes(metric)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== metric);
      }
      return [...prev, metric];
    });
  };

  const hasData = chartData.length > 0;

  const socColor =
    soc == null ? "text-zinc-400"
    : soc >= 80 ? "text-emerald-400"
    : soc >= 50 ? "text-amber-400"
    : soc >= 20 ? "text-orange-400"
    : "text-red-400";

  const currentColor = (current ?? 0) >= 0 ? "text-emerald-400" : "text-amber-400";

  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="pb-2">
        {(soc != null || current != null || insideTemperature != null || outsideTemperature != null) && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {soc != null && (
              <span className={`text-base font-semibold tabular-nums ${socColor}`}>
                {soc.toFixed(0)}%
              </span>
            )}
            {current != null && (
              <span className={`text-base font-semibold tabular-nums ${currentColor}`}>
                {current >= 0 ? "+" : ""}{current.toFixed(1)}A
              </span>
            )}
            {insideTemperature != null && (
              <span className="text-base tabular-nums text-zinc-400">
                <span className="text-zinc-600">in </span>{insideTemperature.toFixed(1)}°C
              </span>
            )}
            {outsideTemperature != null && (
              <span className="text-base tabular-nums text-zinc-400">
                <span className="text-zinc-600">out </span>{outsideTemperature.toFixed(1)}°C
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-lg font-semibold text-white">
            History
          </CardTitle>

          <Select
            value={timeRange}
            onValueChange={(value) => setTimeRange(value as TimeRange)}
          >
            <SelectTrigger className="w-full border-zinc-700 bg-zinc-800 text-white sm:w-[140px]">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900 text-white">
              {timeRangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(metricConfig) as Metric[]).map((metric) => (
            <button
              key={metric}
              onClick={() => toggleMetric(metric)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                activeMetrics.includes(metric)
                  ? "bg-zinc-800 text-white"
                  : "bg-zinc-800/50 text-zinc-500"
              }`}
            >
              <div
                className={`h-2 w-2 rounded-full transition-opacity ${
                  activeMetrics.includes(metric) ? "opacity-100" : "opacity-30"
                }`}
                style={{ backgroundColor: metricConfig[metric].color }}
              />
              {metricConfig[metric].label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="h-[300px] md:h-[400px]">
          {!hasData ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
              No data available for this time range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />

                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  ticks={getXAxisTicks(chartData, timeRange)}
                  tickFormatter={(value) =>
                    formatXAxis(new Date(value), timeRange)
                  }
                  stroke="#52525b"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                  tickLine={{ stroke: "#52525b" }}
                />

                {activeMetrics.includes("voltage") && (
                  <YAxis
                    yAxisId="voltage"
                    orientation="left"
                    domain={["auto", "auto"]}
                    stroke="#52525b"
                    tick={{ fill: "#38bdf8", fontSize: 12 }}
                    tickLine={{ stroke: "#52525b" }}
                    width={50}
                    tickFormatter={(value) => `${value}V`}
                  />
                )}

                {activeMetrics.includes("current") &&
                  !activeMetrics.includes("voltage") && (
                    <YAxis
                      yAxisId="current"
                      orientation="left"
                      domain={["auto", "auto"]}
                      stroke="#52525b"
                      tick={{ fill: "#a3e635", fontSize: 12 }}
                      tickLine={{ stroke: "#52525b" }}
                      width={50}
                      tickFormatter={(value) => `${value}A`}
                    />
                  )}

                {activeMetrics.includes("current") &&
                  activeMetrics.includes("voltage") && (
                    <YAxis
                      yAxisId="current"
                      orientation="right"
                      domain={["auto", "auto"]}
                      stroke="#52525b"
                      tick={{ fill: "#a3e635", fontSize: 12 }}
                      tickLine={{ stroke: "#52525b" }}
                      width={50}
                      tickFormatter={(value) => `${value}A`}
                    />
                  )}

                {activeMetrics.includes("soc") && (
                  <YAxis
                    yAxisId="soc"
                    orientation="right"
                    domain={[0, 100]}
                    stroke="#52525b"
                    tick={{ fill: "#f97316", fontSize: 12 }}
                    tickLine={{ stroke: "#52525b" }}
                    width={50}
                    tickFormatter={(value) => `${value}%`}
                    hide={
                      activeMetrics.includes("current") &&
                      activeMetrics.includes("voltage")
                    }
                  />
                )}

                {(activeMetrics.includes("insideTemperature") ||
                  activeMetrics.includes("outsideTemperature")) && (
                  <YAxis
                    yAxisId="temperature"
                    orientation="right"
                    domain={["auto", "auto"]}
                    stroke="#52525b"
                    tick={{ fill: "#e879f9", fontSize: 12 }}
                    tickLine={{ stroke: "#52525b" }}
                    width={50}
                    tickFormatter={(value) => `${value}°C`}
                    hide={
                      activeMetrics.includes("soc") ||
                      activeMetrics.includes("speed") ||
                      (activeMetrics.includes("current") &&
                        activeMetrics.includes("voltage"))
                    }
                  />
                )}

                {activeMetrics.includes("speed") && (
                  <YAxis
                    yAxisId="speed"
                    orientation="right"
                    domain={[0, "auto"]}
                    stroke="#52525b"
                    tick={{ fill: "#22c55e", fontSize: 12 }}
                    tickLine={{ stroke: "#52525b" }}
                    width={60}
                    tickFormatter={(value) => `${value}km/h`}
                    hide={
                      activeMetrics.includes("soc") ||
                      activeMetrics.includes("insideTemperature") ||
                      activeMetrics.includes("outsideTemperature") ||
                      (activeMetrics.includes("current") &&
                        activeMetrics.includes("voltage"))
                    }
                  />
                )}

                <Tooltip content={<CustomTooltip />} />

                {activeMetrics.includes("voltage") && (
                  <Line
                    yAxisId="voltage"
                    type="monotone"
                    dataKey="voltage"
                    connectNulls={false}
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )}

                {activeMetrics.includes("current") && (
                  <Line
                    yAxisId="current"
                    type="monotone"
                    dataKey="current"
                    connectNulls={false}
                    stroke="#a3e635"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )}

                {activeMetrics.includes("soc") && (
                  <Line
                    yAxisId="soc"
                    type="monotone"
                    dataKey="soc"
                    connectNulls={false}
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )}

                {activeMetrics.includes("insideTemperature") && (
                  <Line
                    yAxisId="temperature"
                    type="monotone"
                    dataKey="insideTemperature"
                    connectNulls={false}
                    stroke="#e879f9"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )}

                {activeMetrics.includes("outsideTemperature") && (
                  <Line
                    yAxisId="temperature"
                    type="monotone"
                    dataKey="outsideTemperature"
                    connectNulls={false}
                    stroke="#facc15"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )}

                {activeMetrics.includes("speed") && (
                  <Line
                    yAxisId="speed"
                    type="monotone"
                    dataKey="speed"
                    connectNulls={false}
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TelemetryChartPoint = {
  timestampMs?: number;
  voltage: number | null;
  current: number | null;
  soc: number | null;
};

type TelemetryChartProps = {
  data: TelemetryChartPoint[];
};

const METRICS = {
  voltage: { label: "Voltage", color: "#2563eb" },
  current: { label: "Current", color: "#16a34a" },
  soc: { label: "SOC", color: "#d97706" },
} as const;

const RANGES = {
  "1h": { label: "Last hour", ms: 60 * 60 * 1000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "Last week", ms: 7 * 24 * 60 * 60 * 1000 },
} as const;

type MetricKey = keyof typeof METRICS;
type RangeKey = keyof typeof RANGES;

function formatTick(value: number, range: RangeKey) {
  const date = new Date(value);

  if (range === "7d") {
    return date.toLocaleDateString([], {
      day: "numeric",
      month: "short",
    });
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTooltipLabel(label: unknown) {
  if (typeof label === "number") {
    return new Date(label).toLocaleString();
  }

  return String(label ?? "");
}

function formatTooltipValue(value: unknown): string {
  if (typeof value === "number") return value.toFixed(2);
  if (Array.isArray(value)) {
    return value.map((entry) => formatTooltipValue(entry)).join(" - ");
  }
  return "-";
}

export function TelemetryChart({ data }: TelemetryChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("voltage");
  const [selectedRange, setSelectedRange] = useState<RangeKey>("24h");

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  }, [data]);

  const filteredData = useMemo(() => {
    if (sortedData.length === 0) return [];

    const timestamps = sortedData
      .map((point) => point.timestampMs)
      .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

    if (timestamps.length === 0) return sortedData;

    const latestTimestamp = Math.max(...timestamps);
    const cutoff = latestTimestamp - RANGES[selectedRange].ms;

    return sortedData.filter((point) => {
      if (typeof point.timestampMs !== "number" || Number.isNaN(point.timestampMs)) {
        return false;
      }

      return point.timestampMs >= cutoff;
    });
  }, [sortedData, selectedRange]);

  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No historical readings yet.
      </p>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-medium">Metric:</span>
          <select
            value={selectedMetric}
            onChange={(event) => setSelectedMetric(event.target.value as MetricKey)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {Object.entries(METRICS).map(([key, metric]) => (
              <option key={key} value={key}>
                {metric.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className="font-medium">Range:</span>
          <select
            value={selectedRange}
            onChange={(event) => setSelectedRange(event.target.value as RangeKey)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {Object.entries(RANGES).map(([key, range]) => (
              <option key={key} value={key}>
                {range.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filteredData.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No readings available for the selected time range.
        </p>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filteredData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis
                dataKey="timestampMs"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value) => formatTick(Number(value), selectedRange)}
                minTickGap={36}
                stroke="#71717a"
              />
              <YAxis
                stroke="#71717a"
                width={44}
                domain={["auto", "auto"]}
                allowDataOverflow={false}
              />
              <Tooltip
                labelFormatter={formatTooltipLabel}
                formatter={(value) => formatTooltipValue(value)}
              />
              <Line
                type="monotone"
                dataKey={selectedMetric}
                name={METRICS[selectedMetric].label}
                stroke={METRICS[selectedMetric].color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
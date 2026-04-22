"use client";

import { useState } from "react";
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
  receivedAt: string;
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

type MetricKey = keyof typeof METRICS;

function formatTick(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTooltipLabel(label: unknown) {
  if (typeof label === "string" || typeof label === "number") {
    return new Date(label).toLocaleString();
  }

  return String(label ?? "");
}

function formatTooltipValue(value: unknown): string {
  if (typeof value === "number") return value.toFixed(2);
  if (Array.isArray(value)) return value.map((entry) => formatTooltipValue(entry)).join(" - ");
  return "-";
}

export function TelemetryChart({ data }: TelemetryChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("voltage");

  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No historical readings yet.
      </p>
    );
  }

  return (
    <div className="w-full">
      <label className="mb-3 flex items-center gap-2 text-sm">
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

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
            <XAxis
              dataKey="receivedAt"
              tickFormatter={formatTick}
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
    </div>
  );
}

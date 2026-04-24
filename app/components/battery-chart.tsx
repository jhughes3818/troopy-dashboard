"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type TimeRange = "1h" | "24h" | "1w"
type Metric = "voltage" | "current" | "soc" | "insideTemperature" | "outsideTemperature"

type TelemetryReading = {
  timestampMs: number | string | bigint
  voltage: number | null
  current: number | null
  soc: number | null
  power?: number | null
  auxVoltage?: number | null
  ttgDays?: number | null
  insideTemperature?: number | null
  outsideTemperature?: number | null
  insideTempC?: number | null
  outsideTempC?: number | null
}

type ChartPoint = {
  time: number
  voltage: number | null
  current: number | null
  soc: number | null
  insideTemperature: number | null
  outsideTemperature: number | null
}

interface BatteryChartProps {
  data: TelemetryReading[]
}

function toTimestampMs(value: number | string | bigint): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") return Number(value)
  return value
}

function getRangeStart(range: TimeRange): number {
  const now = Date.now()

  switch (range) {
    case "1h":
      return now - 60 * 60 * 1000
    case "24h":
      return now - 24 * 60 * 60 * 1000
    case "1w":
      return now - 7 * 24 * 60 * 60 * 1000
  }
}

function formatXAxis(date: Date, range: TimeRange): string {
  switch (range) {
    case "1h":
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    case "24h":
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    case "1w":
      return date.toLocaleDateString([], { weekday: "short" })
  }
}

function formatMetricValue(metric: Metric, value: number | null | undefined) {
  if (value == null) return "-"
  if (metric === "soc") return `${value.toFixed(1)}%`
  if (metric === "voltage") return `${value.toFixed(2)}V`
  if (metric === "current") return `${value.toFixed(2)}A`
  return `${value.toFixed(1)}°C`
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: Metric; value: number | null; color: string }>
  label?: number
}) {
  if (!active || !payload?.length || label == null) return null

  const date = new Date(label)

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
          <span className="capitalize text-zinc-400">{entry.dataKey}:</span>
          <span className="font-medium tabular-nums text-white">
            {formatMetricValue(entry.dataKey, entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function BatteryChart({ data }: BatteryChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("24h")
  const [activeMetrics, setActiveMetrics] = useState<Metric[]>([
    "voltage",
    "current",
    "soc",
    "insideTemperature",
    "outsideTemperature",
  ])

  const metricConfig = {
    voltage: { color: "#38bdf8", label: "Voltage (V)", yAxisId: "voltage" },
    current: { color: "#a3e635", label: "Current (A)", yAxisId: "current" },
    soc: { color: "#f97316", label: "SOC (%)", yAxisId: "soc" },
    insideTemperature: {
      color: "#e879f9",
      label: "Inside Temp (°C)",
      yAxisId: "temperature",
    },
    outsideTemperature: {
      color: "#facc15",
      label: "Outside Temp (°C)",
      yAxisId: "temperature",
    },
  } as const

  const chartData = useMemo<ChartPoint[]>(() => {
    const rangeStart = getRangeStart(timeRange)

    return [...data]
      .map((reading) => ({
        time: toTimestampMs(reading.timestampMs),
        voltage: reading.voltage,
        current: reading.current,
        soc: reading.soc,
        insideTemperature:
          reading.insideTemperature ?? reading.insideTempC ?? null,
        outsideTemperature:
          reading.outsideTemperature ?? reading.outsideTempC ?? null,
      }))
      .filter((point) => Number.isFinite(point.time) && point.time >= rangeStart)
      .sort((a, b) => a.time - b.time)
  }, [data, timeRange])

  const toggleMetric = (metric: Metric) => {
    setActiveMetrics((prev) => {
      if (prev.includes(metric)) {
        if (prev.length === 1) return prev
        return prev.filter((m) => m !== metric)
      }
      return [...prev, metric]
    })
  }

  const hasData = chartData.length > 0

  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-lg font-semibold text-white">History</CardTitle>

          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={(value) => value && setTimeRange(value as TimeRange)}
            className="rounded-lg bg-zinc-800 p-1"
          >
            <ToggleGroupItem
              value="1h"
              className="rounded-md px-4 py-1.5 text-sm text-zinc-400 data-[state=on]:bg-zinc-700 data-[state=on]:text-white"
            >
              1H
            </ToggleGroupItem>
            <ToggleGroupItem
              value="24h"
              className="rounded-md px-4 py-1.5 text-sm text-zinc-400 data-[state=on]:bg-zinc-700 data-[state=on]:text-white"
            >
              24H
            </ToggleGroupItem>
            <ToggleGroupItem
              value="1w"
              className="rounded-md px-4 py-1.5 text-sm text-zinc-400 data-[state=on]:bg-zinc-700 data-[state=on]:text-white"
            >
              1W
            </ToggleGroupItem>
          </ToggleGroup>
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
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />

                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  tickFormatter={(value) => formatXAxis(new Date(value), timeRange)}
                  stroke="#52525b"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                  tickLine={{ stroke: "#52525b" }}
                  interval="preserveStartEnd"
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

                {activeMetrics.includes("current") && !activeMetrics.includes("voltage") && (
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

                {activeMetrics.includes("current") && activeMetrics.includes("voltage") && (
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
                    hide={activeMetrics.includes("current") && activeMetrics.includes("voltage")}
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
                      (activeMetrics.includes("current") && activeMetrics.includes("voltage"))
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
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
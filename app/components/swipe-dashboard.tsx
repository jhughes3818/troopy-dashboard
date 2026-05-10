"use client";

import { useState, useRef, useMemo, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Thermometer,
  MapPin,
  Home,
  Sun,
  Snowflake,
  Droplets,
  Fuel,
  Clock,
  Wind,
  RefreshCw,
} from "lucide-react";

const SIX_H = 6 * 60 * 60 * 1000;
const MOTION_THRESHOLD = 5; // km/h
const SIGNIFICANT_WIND_THRESHOLD = 15; // km/h

type ReadingRow = {
  timestampMs: number;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  ttgDays: number | null;
  insideTemperature: number | null;
  outsideTemperature: number | null;
  fridgeTemperature: number | null;
  gpsSpeedKmph: number | null;
  gpsCourseDeg?: number | null;
};

type BatteryHourRow = { hourBucket: number; current: number | null };

type FuelLogEntry = {
  id: string;
  filledAt: number;
  litres: number;
  isFull: boolean;
  distanceKm: number | null;
  gpsDistanceKm: number | null;
  pricePerL: number | null;
  notes: string | null;
};

type GpsRow = {
  timestampMs: number;
  gpsSpeedKmph: number | null;
  gpsCourseDeg?: number | null;
};

type WeatherRow = {
  id: string;
  sourceTimestampMs: string | null;
  fetchedAt: string;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
};

interface SwipeDashboardProps {
  readings: ReadingRow[];
  latest: ReadingRow | null;
  deviceId?: string | null;
  waterRemainingL?: number | null;
  waterRemainingPct?: number | null;
  waterTankL?: number;
  waterDailyUsage?: { date: string; usedL: number }[];
  batteryHourly?: BatteryHourRow[];
  fuelLogs?: FuelLogEntry[];
  fuelTankCapacityL?: number | null;
  gpsHistory?: GpsRow[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Sparkline({
  data,
  color,
  min,
  max,
  height = 48,
}: {
  data: number[];
  color: string;
  min: number;
  max: number;
  height?: number;
}) {
  if (data.length < 2) return <div style={{ height }} />;
  const w = 300;
  const h = height;
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: "100%", height, display: "block" }}
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MiniGauge({
  value,
  max = 100,
  color,
  size = 80,
}: {
  value: number;
  max?: number;
  color: string;
  size?: number;
}) {
  const r = 32,
    cx = 40,
    cy = 40;
  const circumference = Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = pct * circumference;
  return (
    <svg width={size} height={size / 2 + 10} viewBox="0 0 80 50">
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fill="white"
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--font-geist-mono), monospace"
      >
        {Math.round(value)}%
      </text>
    </svg>
  );
}

function formatTTG(
  ttgDays: number | null | undefined,
  current: number | null | undefined,
): string {
  if (ttgDays == null) return "—";
  if (current != null && current > 0) return "Charging";
  const totalHours = ttgDays * 24;
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);
  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    return `${d}d ${h}h`;
  }
  return `${hours}h ${minutes}m`;
}

function makeTimeLabels(history: { timestampMs: number }[]): string[] {
  if (history.length < 2) return [];
  const start = history[0].timestampMs;
  const end = history[history.length - 1].timestampMs;
  return Array.from({ length: 7 }, (_, i) => {
    if (i === 6) return "now";
    const t = new Date(start + (end - start) * (i / 6));
    const h = t.getHours();
    const suffix = h < 12 ? "am" : "pm";
    return `${h % 12 || 12}${suffix}`;
  });
}

// ── Card components ───────────────────────────────────────────────────────────

function AmpHoursBarChart({ data }: { data: BatteryHourRow[] }) {
  if (!data.length) return null;

  const bars = data.map((row) => ({
    hourBucket: row.hourBucket,
    ah: row.current != null ? row.current : 0,
  }));

  const absMax = Math.max(...bars.map((b) => Math.abs(b.ah)), 0.1);
  const w = 280;
  const h = 72;
  const midY = h / 2;
  const slotW = w / bars.length;
  const barW = Math.max(slotW * 0.6, 2);
  const gap = slotW - barW;

  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.3)",
          marginBottom: 6,
        }}
      >
        Amp-Hours / Hour (24h)
      </div>
      <div
        style={{ borderRadius: 8, overflow: "hidden", position: "relative" }}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          style={{ width: "100%", height: h, display: "block" }}
          preserveAspectRatio="none"
        >
          {/* baseline */}
          <line
            x1={0}
            y1={midY}
            x2={w}
            y2={midY}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={0.5}
          />
          {bars.map((b, i) => {
            const x = slotW * i + gap / 2;
            const scale = (Math.abs(b.ah) / absMax) * (midY - 4);
            const barH = Math.max(1.5, scale);
            const isCharge = b.ah >= 0;
            const y = isCharge ? midY - barH : midY;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={1.5}
                fill={isCharge ? "#4ade80" : "#f87171"}
                opacity={0.8}
              />
            );
          })}
        </svg>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
        }}
      >
        {[bars[0], bars[Math.floor(bars.length / 2)], bars[bars.length - 1]]
          .filter(Boolean)
          .map((b) => (
            <span
              key={b.hourBucket}
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.2)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {new Date(b.hourBucket).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </span>
          ))}
      </div>
    </div>
  );
}

function BatteryCard({
  history,
  latest,
  hourlyData = [],
}: {
  history: ReadingRow[];
  latest: ReadingRow;
  hourlyData?: BatteryHourRow[];
}) {
  const curData = history
    .map((r) => r.current)
    .filter((v): v is number => v !== null);
  const curMin = curData.length ? Math.min(...curData) - 0.2 : -1;
  const curMax = curData.length ? Math.max(...curData) + 0.2 : 1;
  const timeLabels = makeTimeLabels(history);
  const soc = latest.soc ?? 0;
  const socColor = soc > 50 ? "#4ade80" : soc > 25 ? "#f59e0b" : "#ef4444";
  const voltage = latest.voltage;
  const current = latest.current;
  const power =
    latest.power ??
    (voltage != null && current != null ? voltage * current : null);

  const stats = [
    {
      label: "Voltage",
      value: voltage != null ? voltage.toFixed(2) : "—",
      unit: "V",
      color: "#60a5fa",
    },
    {
      label: "Current",
      value: current != null ? current.toFixed(1) : "—",
      unit: "A",
      color: "#a78bfa",
    },
    {
      label: "Time to Go",
      value: formatTTG(latest.ttgDays, current),
      unit: "",
      color: "#34d399",
    },
    {
      label: "Power",
      value: power != null ? Math.abs(power).toFixed(1) : "—",
      unit: "W",
      color: "#fb923c",
    },
  ];

  return (
    <div style={{ padding: "20px 20px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
              marginBottom: 4,
            }}
          >
            State of Charge
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontSize: 42,
                fontWeight: 800,
                color: socColor,
                fontFamily: "var(--font-geist-mono), monospace",
                lineHeight: 1,
                filter: `drop-shadow(0 0 12px ${socColor}88)`,
              }}
            >
              {Math.round(soc)}
            </span>
            <span
              style={{
                fontSize: 18,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              %
            </span>
          </div>
        </div>
        <MiniGauge value={soc} color={socColor} size={90} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {stats.map(({ label, value, unit, color }) => (
          <div
            key={label}
            style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                marginBottom: 4,
              }}
            >
              {label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {value}
              </span>
              {unit && (
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.3)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 6 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
            marginBottom: 6,
          }}
        >
          6hr Current
        </div>
        <div style={{ borderRadius: 8, overflow: "hidden" }}>
          <Sparkline
            data={curData}
            color="#a78bfa"
            min={curMin}
            max={curMax}
            height={52}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: 2,
        }}
      >
        {timeLabels.map((t, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {t}
          </span>
        ))}
      </div>

      {hourlyData.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <AmpHoursBarChart data={hourlyData} />
        </div>
      )}
    </div>
  );
}

function TempCard({
  history,
  latest,
}: {
  history: ReadingRow[];
  latest: ReadingRow;
}) {
  const timeLabels = makeTimeLabels(history);
  const sensors = [
    {
      label: "Inside",
      value: latest.insideTemperature,
      data: history
        .map((r) => r.insideTemperature)
        .filter((v): v is number => v !== null),
      color: "#f472b6",
      icon: <Home size={15} color="#f472b6" />,
    },
    {
      label: "Outside",
      value: latest.outsideTemperature,
      data: history
        .map((r) => r.outsideTemperature)
        .filter((v): v is number => v !== null),
      color: "#fbbf24",
      icon: <Sun size={15} color="#fbbf24" />,
    },
    {
      label: "Fridge",
      value: latest.fridgeTemperature,
      data: history
        .map((r) => r.fridgeTemperature)
        .filter((v): v is number => v !== null),
      color: "#38bdf8",
      icon: <Snowflake size={15} color="#38bdf8" />,
    },
  ];

  return (
    <div style={{ padding: "20px 20px 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 16,
        }}
      >
        <span>Temperature Sensors</span>
        <span style={{ color: "rgba(255,255,255,0.25)" }}>Last 6h</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sensors.map(({ label, value, data, color, icon }) => {
          const minV = data.length ? Math.min(...data) - 0.5 : 0;
          const maxV = data.length ? Math.max(...data) + 0.5 : 10;
          return (
            <div
              key={label}
              style={{
                background: "rgba(255,255,255,0.04)",
                borderRadius: 12,
                padding: "12px 14px",
                border: `1px solid ${color}22`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {icon}
                  <span
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.4)",
                    }}
                  >
                    {label}
                  </span>
                </div>
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 2 }}
                >
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color,
                      fontFamily: "var(--font-geist-mono), monospace",
                      filter: `drop-shadow(0 0 8px ${color}66)`,
                    }}
                  >
                    {value != null ? value.toFixed(1) : "—"}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  >
                    °C
                  </span>
                </div>
              </div>
              <div style={{ position: "relative" }}>
                <Sparkline
                  data={data}
                  color={color}
                  min={minV}
                  max={maxV}
                  height={36}
                />
                {data.length > 0 && (
                  <>
                    <span
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        fontSize: 9,
                        color: "rgba(255,255,255,0.3)",
                        fontFamily: "var(--font-geist-mono), monospace",
                        lineHeight: 1,
                      }}
                    >
                      {Math.max(...data).toFixed(1)}°
                    </span>
                    <span
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        fontSize: 9,
                        color: "rgba(255,255,255,0.3)",
                        fontFamily: "var(--font-geist-mono), monospace",
                        lineHeight: 1,
                      }}
                    >
                      {Math.min(...data).toFixed(1)}°
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: 8,
        }}
      >
        {timeLabels.map((t, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function circularDiffDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function nearestWeatherForTimestamp(
  weather: WeatherRow[],
  timestampMs: number,
): WeatherRow | null {
  if (!weather.length) return null;

  let nearest: WeatherRow | null = null;
  let nearestDiff = Infinity;

  for (const row of weather) {
    const weatherMs =
      row.sourceTimestampMs != null
        ? Number(row.sourceTimestampMs)
        : Date.parse(row.fetchedAt);
    if (!Number.isFinite(weatherMs)) continue;

    const diff = Math.abs(weatherMs - timestampMs);
    if (diff < nearestDiff) {
      nearest = row;
      nearestDiff = diff;
    }
  }

  return nearestDiff <= 45 * 60 * 1000 ? nearest : null;
}

function classifyWindRelativeToTravel(
  windDirectionDeg: number | null | undefined,
  vehicleCourseDeg: number | null | undefined,
  windSpeedKmh: number | null | undefined,
): "headwind" | "tailwind" | "crosswind" | null {
  if (
    windDirectionDeg == null ||
    vehicleCourseDeg == null ||
    windSpeedKmh == null
  ) {
    return null;
  }

  if (
    !Number.isFinite(windDirectionDeg) ||
    !Number.isFinite(vehicleCourseDeg) ||
    !Number.isFinite(windSpeedKmh)
  ) {
    return null;
  }

  if (windSpeedKmh < SIGNIFICANT_WIND_THRESHOLD) {
    return null;
  }

  const headwindDiff = circularDiffDeg(windDirectionDeg, vehicleCourseDeg);
  if (headwindDiff <= 30) return "headwind";

  const tailwindDiff = circularDiffDeg(
    windDirectionDeg,
    (vehicleCourseDeg + 180) % 360,
  );
  if (tailwindDiff <= 30) return "tailwind";

  return "crosswind";
}

function GpsCard({
  history,
  gpsHistory = [],
  deviceId,
}: {
  history: ReadingRow[];
  gpsHistory?: GpsRow[];
  deviceId?: string | null;
}) {
  const days = useMemo(() => {
    if (!gpsHistory.length) return [];
    const map = new Map<string, GpsRow[]>();
    for (const r of gpsHistory) {
      const key = localDateKey(r.timestampMs);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => ({ date, rows }));
  }, [gpsHistory]);

  const [dayIndex, setDayIndex] = useState(0);
  const [prevDaysLen, setPrevDaysLen] = useState(0);
  if (days.length !== prevDaysLen) {
    setPrevDaysLen(days.length);
    setDayIndex(Math.max(0, days.length - 1));
  }

  const [weatherRows, setWeatherRows] = useState<WeatherRow[]>([]);

  useEffect(() => {
    const rows = gpsHistory.length ? gpsHistory : history;
    if (!rows.length) return;

    const sortedRows = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
    const cacheBucketMs = 60 * 60 * 1000;
    const from =
      Math.floor((sortedRows[0].timestampMs - 60 * 60 * 1000) / cacheBucketMs) *
      cacheBucketMs;
    const to =
      Math.ceil(
        (sortedRows[sortedRows.length - 1].timestampMs + 60 * 60 * 1000) /
          cacheBucketMs,
      ) * cacheBucketMs;
    const params = new URLSearchParams({
      deviceId: deviceId ?? "troopy-smartshunt",
      from: String(from),
      to: String(to),
    });

    let cancelled = false;

    fetch(`/api/weather?${params.toString()}`)
      .then((res) =>
        res.ok
          ? res.json()
          : Promise.reject(new Error(`Weather request failed: ${res.status}`)),
      )
      .then((json) => {
        if (!cancelled && Array.isArray(json.readings)) {
          setWeatherRows(json.readings);
        }
      })
      .catch(() => {
        if (!cancelled) setWeatherRows([]);
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, gpsHistory, history]);

  const hasDays = days.length > 0;
  const activeIndex = Math.min(dayIndex, Math.max(0, days.length - 1));
  const selectedDay = hasDays ? days[activeIndex] : null;
  const activeRows: GpsRow[] = selectedDay?.rows ?? [];
  const rowsForStats = hasDays ? activeRows : history;

  const speedData = rowsForStats.map((r) => r.gpsSpeedKmph ?? 0);
  const windStates = rowsForStats.map((row) => {
    const nearestWeather = nearestWeatherForTimestamp(
      weatherRows,
      row.timestampMs,
    );
    return classifyWindRelativeToTravel(
      nearestWeather?.windDirectionDeg,
      row.gpsCourseDeg,
      nearestWeather?.windSpeedKmh,
    );
  });
  const timeLabels = makeTimeLabels(rowsForStats);

  let distanceKm = 0;
  let maxSpeedKmph = 0;
  let movingMs = 0;

  for (let i = 1; i < rowsForStats.length; i++) {
    const speed = rowsForStats[i].gpsSpeedKmph ?? 0;
    const dt =
      (rowsForStats[i].timestampMs - rowsForStats[i - 1].timestampMs) /
      3_600_000;
    if (speed > MOTION_THRESHOLD) {
      distanceKm += speed * dt;
      movingMs += rowsForStats[i].timestampMs - rowsForStats[i - 1].timestampMs;
    }
    if (speed > maxSpeedKmph) maxSpeedKmph = speed;
  }

  const movingMins = movingMs / 60_000;

  const segments: { start: number; end: number }[] = [];
  let inMove = false;
  let segStart = 0;
  speedData.forEach((s, i) => {
    if (s > MOTION_THRESHOLD && !inMove) {
      inMove = true;
      segStart = i;
    }
    if (s <= MOTION_THRESHOLD && inMove) {
      segments.push({ start: segStart, end: i });
      inMove = false;
    }
  });
  if (inMove) segments.push({ start: segStart, end: speedData.length });

  const windSegments: {
    start: number;
    end: number;
    state: "headwind" | "tailwind" | "crosswind";
  }[] = [];
  let activeWindState: "headwind" | "tailwind" | "crosswind" | null = null;
  let windSegStart = 0;

  windStates.forEach((state, i) => {
    const speed = speedData[i] ?? 0;
    const effectiveState = speed > MOTION_THRESHOLD ? state : null;

    if (effectiveState !== activeWindState) {
      if (activeWindState != null) {
        windSegments.push({
          start: windSegStart,
          end: i,
          state: activeWindState,
        });
      }
      activeWindState = effectiveState;
      windSegStart = i;
    }
  });

  if (activeWindState != null) {
    windSegments.push({
      start: windSegStart,
      end: windStates.length,
      state: activeWindState,
    });
  }

  const headwindMins = windSegments
    .filter((segment) => segment.state === "headwind")
    .reduce((total, segment) => {
      const start = rowsForStats[segment.start]?.timestampMs;
      const end =
        rowsForStats[Math.min(segment.end, rowsForStats.length - 1)]
          ?.timestampMs;
      return start != null && end != null
        ? total + Math.max(0, end - start) / 60_000
        : total;
    }, 0);

  const tailwindMins = windSegments
    .filter((segment) => segment.state === "tailwind")
    .reduce((total, segment) => {
      const start = rowsForStats[segment.start]?.timestampMs;
      const end =
        rowsForStats[Math.min(segment.end, rowsForStats.length - 1)]
          ?.timestampMs;
      return start != null && end != null
        ? total + Math.max(0, end - start) / 60_000
        : total;
    }, 0);

  const stats = [
    {
      label: "Distance",
      value: distanceKm.toFixed(1),
      unit: "km",
      color: "#34d399",
    },
    {
      label: "Max Speed",
      value: Math.round(maxSpeedKmph).toString(),
      unit: "km/h",
      color: "#60a5fa",
    },
    {
      label: "Moving",
      value: Math.round(movingMins).toString(),
      unit: "min",
      color: "#a78bfa",
    },
  ];

  const windStats = [
    {
      label: "Headwind",
      value: Math.round(headwindMins).toString(),
      unit: "min",
      color: "#f87171",
    },
    {
      label: "Tailwind",
      value: Math.round(tailwindMins).toString(),
      unit: "min",
      color: "#34d399",
    },
  ];

  const [mountMs] = useState(() => Date.now());
  const todayKey = localDateKey(mountMs);
  const yesterdayKey = localDateKey(mountMs - 86_400_000);

  function dayLabel(date: string): string {
    if (date === todayKey) return "Today";
    if (date === yesterdayKey) return "Yesterday";
    return new Date(date + "T12:00:00").toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    background: "none",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    color: disabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.55)",
    padding: "4px 10px",
    fontSize: 20,
    lineHeight: 1,
    borderRadius: 6,
    transition: "color 0.15s ease",
  });

  return (
    <div style={{ padding: "20px 20px 16px" }}>
      {/* Header: day navigation or static title */}
      {hasDays ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <button
            onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
            disabled={activeIndex === 0}
            style={navBtnStyle(activeIndex === 0)}
          >
            ‹
          </button>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "white",
                letterSpacing: "0.02em",
              }}
            >
              {selectedDay ? dayLabel(selectedDay.date) : "—"}
            </div>
            {days.length > 1 && (
              <div
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.28)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginTop: 2,
                }}
              >
                {activeIndex + 1} / {days.length}
              </div>
            )}
          </div>
          <button
            onClick={() => setDayIndex((i) => Math.min(days.length - 1, i + 1))}
            disabled={activeIndex === days.length - 1}
            style={navBtnStyle(activeIndex === days.length - 1)}
          >
            ›
          </button>
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
            marginBottom: 16,
          }}
        >
          GPS & Travel
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 18,
        }}
      >
        {stats.map(({ label, value, unit, color }) => (
          <div
            key={label}
            style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              padding: 10,
              border: "1px solid rgba(255,255,255,0.07)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                marginBottom: 4,
              }}
            >
              {label}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 2,
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {value}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.3)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 6 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
            marginBottom: 6,
          }}
        >
          Speed History
        </div>
        <div
          style={{
            position: "relative",
            borderRadius: 8,
            overflow: "hidden",
            background: "rgba(255,255,255,0.02)",
            paddingTop: 8,
          }}
        >
          <Sparkline
            data={speedData}
            color="#60a5fa"
            min={0}
            max={Math.max(100, maxSpeedKmph + 10)}
            height={60}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        {timeLabels.map((t, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {t}
          </span>
        ))}
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          borderRadius: 12,
          padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
            marginBottom: 10,
          }}
        >
          Journey Timeline
        </div>
        <div
          style={{
            position: "relative",
            height: 10,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          {speedData.length > 0 &&
            segments.map(({ start, end }, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${(start / speedData.length) * 100}%`,
                  width: `${((end - start) / speedData.length) * 100}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                  borderRadius: 5,
                }}
              />
            ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          {(["parked", "driving", "parked"] as const).map((s, i) => (
            <span
              key={i}
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.25)",
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          borderRadius: 12,
          padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.07)",
          marginTop: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Wind size={13} color="rgba(255,255,255,0.35)" />
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.3)",
              }}
            >
              Wind Timeline
            </span>
          </div>
          <span
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.22)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            ±30° / 30+ km/h
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 10,
          }}
        >
          {windStats.map(({ label, value, unit, color }) => (
            <div
              key={label}
              style={{
                background: "rgba(255,255,255,0.035)",
                borderRadius: 8,
                padding: "8px 10px",
                border: `1px solid ${color}22`,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 3,
                }}
              >
                {label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color,
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {value}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.3)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {unit}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            position: "relative",
            height: 10,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          {windStates.length > 0 &&
            windSegments.map(({ start, end, state }, i) => {
              const color =
                state === "headwind"
                  ? "#f87171"
                  : state === "tailwind"
                    ? "#34d399"
                    : "#60a5fa";
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${(start / windStates.length) * 100}%`,
                    width: `${((end - start) / windStates.length) * 100}%`,
                    height: "100%",
                    background: color,
                    opacity: 0.85,
                    borderRadius: 5,
                  }}
                />
              );
            })}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          {(["headwind", "crosswind", "tailwind"] as const).map((label) => (
            <span
              key={label}
              style={{
                fontSize: 9,
                color:
                  label === "headwind"
                    ? "#f8717188"
                    : label === "tailwind"
                      ? "#34d39988"
                      : "#60a5fa88",
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BarChart({
  data,
  color,
  height = 60,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  if (!data.length) return <div style={{ height }} />;
  const w = 280;
  const h = height;
  const max = Math.max(...data, 0.01);
  const slotW = w / data.length;
  const barW = slotW * 0.6;
  const gap = slotW * 0.4;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: "100%", height, display: "block" }}
      preserveAspectRatio="none"
    >
      {data.map((v, i) => {
        const x = slotW * i + gap / 2;
        const barH = Math.max(2, (v / max) * (h - 4));
        const y = h - barH;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={2}
            fill={color}
            opacity={v > 0 ? 0.75 : 0.15}
          />
        );
      })}
    </svg>
  );
}

function WaterCard({
  remainingL,
  remainingPct,
  tankL = 45,
  dailyUsage = [],
}: {
  remainingL: number | null | undefined;
  remainingPct: number | null | undefined;
  tankL?: number;
  dailyUsage?: { date: string; usedL: number }[];
}) {
  const router = useRouter();
  const [marking, setMarking] = useState<"idle" | "loading" | "done">("idle");

  async function handleMarkFull() {
    setMarking("loading");
    try {
      const res = await fetch("/api/water", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filledAt: new Date().toISOString() }),
      });
      const json = await res.json();
      if (json.ok) {
        setMarking("done");
        router.refresh();
        setTimeout(() => setMarking("idle"), 2500);
      } else {
        setMarking("idle");
      }
    } catch {
      setMarking("idle");
    }
  }

  const pct = remainingPct ?? 0;
  const waterColor = pct > 50 ? "#38bdf8" : pct > 20 ? "#fbbf24" : "#ef4444";

  const usedValues = dailyUsage.map((d) => d.usedL);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const completedDays = dailyUsage.filter((d) => d.date < todayUtc);
  const avgUsedL = completedDays.length
    ? completedDays.reduce((s, d) => s + d.usedL, 0) / completedDays.length
    : null;

  const dayLabels = dailyUsage.map(({ date }) => {
    const d = new Date(date + "T12:00:00Z");
    return d.toLocaleDateString([], { weekday: "short" });
  });

  return (
    <div style={{ padding: "20px 20px 16px" }}>
      {/* Level display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
              marginBottom: 4,
            }}
          >
            Remaining
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 42,
                fontWeight: 800,
                color: waterColor,
                fontFamily: "var(--font-geist-mono), monospace",
                lineHeight: 1,
                filter: `drop-shadow(0 0 12px ${waterColor}88)`,
              }}
            >
              {remainingL != null ? remainingL.toFixed(1) : "—"}
            </span>
            <span
              style={{
                fontSize: 18,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              L
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.3)",
              marginBottom: 4,
            }}
          >
            of {tankL}L
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: waterColor,
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {remainingPct != null ? `${Math.round(remainingPct)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Fill bar */}
      <div
        style={{
          height: 8,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, pct)}%`,
            background: `linear-gradient(90deg, ${waterColor}88, ${waterColor})`,
            borderRadius: 4,
            transition: "width 0.6s ease",
            boxShadow: `0 0 8px ${waterColor}66`,
          }}
        />
      </div>

      {/* Average usage stat */}
      {avgUsedL !== null && (
        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            borderRadius: 10,
            padding: "10px 12px",
            border: "1px solid rgba(255,255,255,0.07)",
            marginBottom: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)",
            }}
          >
            Avg daily use
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#38bdf8",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {avgUsedL.toFixed(1)}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.3)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              L/day
            </span>
          </div>
        </div>
      )}

      {/* Daily usage bar chart */}
      <div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
            marginBottom: 8,
          }}
        >
          Daily Usage
        </div>
        <div style={{ borderRadius: 8, overflow: "hidden" }}>
          <BarChart data={usedValues} color="#38bdf8" height={64} />
        </div>
        {dayLabels.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              paddingTop: 6,
            }}
          >
            {dayLabels.map((label, i) => (
              <span
                key={i}
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  flex: 1,
                  textAlign: "center",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {dailyUsage.length === 0 && (
          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "rgba(255,255,255,0.2)",
              padding: "16px 0",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            No usage data
          </div>
        )}
      </div>

      <button
        onClick={handleMarkFull}
        disabled={marking !== "idle"}
        style={{
          marginTop: 18,
          width: "100%",
          padding: "8px 12px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          color: marking === "done" ? "#38bdf8" : "rgba(255,255,255,0.45)",
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: marking === "idle" ? "pointer" : "default",
          fontFamily: "var(--font-geist-mono), monospace",
          transition: "color 0.2s ease, border-color 0.2s ease",
        }}
      >
        {marking === "loading"
          ? "Saving…"
          : marking === "done"
            ? "Marked as full"
            : "Mark tank as full"}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "white",
  fontSize: 14,
  fontFamily: "var(--font-geist-mono), monospace",
  outline: "none",
  boxSizing: "border-box",
};

function FuelCard({
  logs = [],
  tankCapacityL,
}: {
  logs?: FuelLogEntry[];
  tankCapacityL?: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<"idle" | "loading" | "done">("idle");
  const [litres, setLitres] = useState("");
  const [pricePerL, setPricePerL] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [isFull, setIsFull] = useState(false);

  async function handleSave() {
    const l = parseFloat(litres);
    if (!isFinite(l) || l <= 0) return;
    setSaving("loading");
    try {
      const res = await fetch("/api/fuel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          litres: l,
          isFull,
          pricePerL: pricePerL ? parseFloat(pricePerL) : undefined,
          distanceKm: distanceKm ? parseFloat(distanceKm) : undefined,
          filledAt: new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSaving("done");
        setOpen(false);
        setLitres("");
        setPricePerL("");
        setDistanceKm("");
        setIsFull(false);
        router.refresh();
        setTimeout(() => setSaving("idle"), 2500);
      } else {
        setSaving("idle");
      }
    } catch {
      setSaving("idle");
    }
  }

  const lastFill = logs[0] ?? null;
  const chronological = [...logs].reverse();

  const economyReadings = logs
    .filter((l) => (l.gpsDistanceKm ?? l.distanceKm) != null && l.litres > 0)
    .map((l) => {
      const dist = (l.gpsDistanceKm ?? l.distanceKm)!;
      return (l.litres / dist) * 100;
    });
  const avgL100km = economyReadings.length
    ? economyReadings.reduce((s, v) => s + v, 0) / economyReadings.length
    : null;

  const litresData = chronological.map((l) => l.litres);
  const fuelColor = "#f97316";

  const dateLabels = [
    chronological[0],
    chronological[Math.floor(chronological.length / 2)],
    chronological[chronological.length - 1],
  ]
    .filter(Boolean)
    .map((l) =>
      new Date(l!.filledAt).toLocaleDateString([], {
        day: "numeric",
        month: "short",
      }),
    );

  const stats = [
    {
      label: "Avg Economy",
      value: avgL100km != null ? avgL100km.toFixed(1) : "—",
      unit: avgL100km != null ? "L/100km" : "",
      color: "#34d399",
    },
    {
      label: "Total Fills",
      value: logs.length.toString(),
      unit: "",
      color: "#60a5fa",
    },
    ...(tankCapacityL != null
      ? [
          {
            label: "Tank",
            value: tankCapacityL.toFixed(0),
            unit: "L",
            color: "#a78bfa",
          },
        ]
      : []),
  ];

  return (
    <div style={{ padding: "20px 20px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
              marginBottom: 4,
            }}
          >
            Last Fill
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 42,
                fontWeight: 800,
                color: fuelColor,
                fontFamily: "var(--font-geist-mono), monospace",
                lineHeight: 1,
                filter: `drop-shadow(0 0 12px ${fuelColor}88)`,
              }}
            >
              {lastFill ? lastFill.litres.toFixed(1) : "—"}
            </span>
            <span
              style={{
                fontSize: 18,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              L
            </span>
          </div>
          {lastFill && (
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.3)",
                marginTop: 4,
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {new Date(lastFill.filledAt).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </div>
          )}
        </div>
        {lastFill?.pricePerL != null && (
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 4,
              }}
            >
              $/L
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: fuelColor,
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {lastFill.pricePerL.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
          gap: 10,
          marginBottom: 18,
        }}
      >
        {stats.map(({ label, value, unit, color }) => (
          <div
            key={label}
            style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                marginBottom: 4,
              }}
            >
              {label}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 3,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {value}
              </span>
              {unit && (
                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.3)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
            marginBottom: 8,
          }}
        >
          Fill History
        </div>
        <div style={{ borderRadius: 8, overflow: "hidden" }}>
          <BarChart data={litresData} color={fuelColor} height={64} />
        </div>
        {litresData.length > 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              paddingTop: 6,
            }}
          >
            {dateLabels.map((label, i) => (
              <span
                key={i}
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "rgba(255,255,255,0.2)",
              padding: "16px 0",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            No fill data
          </div>
        )}
      </div>

      {/* Log fill form */}
      {open ? (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "14px 14px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)",
              marginBottom: 2,
            }}
          >
            Log Fill
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 4,
                  fontFamily: "var(--font-geist-mono), monospace",
                  letterSpacing: "0.08em",
                }}
              >
                Litres *
              </label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="65.0"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 4,
                  fontFamily: "var(--font-geist-mono), monospace",
                  letterSpacing: "0.08em",
                }}
              >
                $/Litre
              </label>
              <input
                type="number"
                inputMode="decimal"
                placeholder="2.19"
                value={pricePerL}
                onChange={(e) => setPricePerL(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 10,
                color: "rgba(255,255,255,0.3)",
                marginBottom: 4,
                fontFamily: "var(--font-geist-mono), monospace",
                letterSpacing: "0.08em",
              }}
            >
              Distance since last fill (km)
            </label>
            <input
              type="number"
              inputMode="decimal"
              placeholder="420"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              style={inputStyle}
            />
          </div>

          <button
            onClick={() => setIsFull((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <div
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: isFull ? fuelColor : "rgba(255,255,255,0.1)",
                position: "relative",
                transition: "background 0.2s ease",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: isFull ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  background: "white",
                  transition: "left 0.2s ease",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 11,
                color: isFull
                  ? "rgba(255,255,255,0.7)"
                  : "rgba(255,255,255,0.3)",
                fontFamily: "var(--font-geist-mono), monospace",
                letterSpacing: "0.06em",
                transition: "color 0.2s ease",
              }}
            >
              Filled to full
            </span>
          </button>

          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button
              onClick={() => {
                setOpen(false);
                setLitres("");
                setPricePerL("");
                setDistanceKm("");
                setIsFull(false);
              }}
              style={{
                flex: 1,
                padding: "8px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 8,
                color: "rgba(255,255,255,0.3)",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
                letterSpacing: "0.08em",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving === "loading" || !litres}
              style={{
                flex: 2,
                padding: "8px",
                background:
                  saving === "done"
                    ? "rgba(249,115,22,0.15)"
                    : "rgba(249,115,22,0.12)",
                border: `1px solid ${fuelColor}44`,
                borderRadius: 8,
                color: saving === "done" ? fuelColor : "rgba(249,115,22,0.8)",
                fontSize: 11,
                cursor: saving === "loading" || !litres ? "default" : "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
                letterSpacing: "0.08em",
                fontWeight: 600,
                transition: "all 0.2s ease",
              }}
            >
              {saving === "loading"
                ? "Saving…"
                : saving === "done"
                  ? "Saved!"
                  : "Save Fill"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            padding: "8px 12px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 8,
            color:
              saving === "done" ? `${fuelColor}99` : "rgba(255,255,255,0.22)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "var(--font-geist-mono), monospace",
            transition: "color 0.2s ease",
          }}
        >
          {saving === "done" ? "Fill logged" : "Log fill"}
        </button>
      )}
    </div>
  );
}

// ── Navigation config ─────────────────────────────────────────────────────────

const NAV_CARDS = [
  { id: "battery", label: "Battery", Icon: Zap },
  { id: "temps", label: "Temps", Icon: Thermometer },
  { id: "gps", label: "GPS", Icon: MapPin },
  { id: "water", label: "Water", Icon: Droplets },
  { id: "fuel", label: "Fuel", Icon: Fuel },
] as const;

// ── Main export ───────────────────────────────────────────────────────────────

export function SwipeDashboard({
  readings,
  latest,
  deviceId,
  waterRemainingL,
  waterRemainingPct,
  waterTankL = 45,
  waterDailyUsage = [],
  batteryHourly = [],
  fuelLogs = [],
  fuelTankCapacityL,
  gpsHistory = [],
}: SwipeDashboardProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [activeCard, setActiveCard] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);

  function handleRefresh() {
    startRefresh(() => {
      router.refresh();
    });
  }

  const history = useMemo(() => {
    if (!readings.length) return [];
    const cutoff = readings[0].timestampMs - SIX_H;
    return readings.filter((r) => r.timestampMs >= cutoff).reverse();
  }, [readings]);

  const handlePointerDown = (x: number) => {
    setDragging(true);
    dragStartRef.current = x;
    setDragOffset(0);
  };

  const handlePointerMove = (x: number) => {
    if (!dragging) return;
    setDragOffset(x - dragStartRef.current);
  };

  const handlePointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragOffset < -50 && activeCard < NAV_CARDS.length - 1)
      setActiveCard((c) => c + 1);
    else if (dragOffset > 50 && activeCard > 0) setActiveCard((c) => c - 1);
    setDragOffset(0);
  };

  if (!latest) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#0a0a0f",
          color: "rgba(255,255,255,0.3)",
          fontSize: 14,
          letterSpacing: "0.1em",
          fontFamily: "var(--font-geist-mono), monospace",
        }}
      >
        No telemetry data
      </div>
    );
  }

  const soc = latest.soc ?? 0;
  const socColor = soc > 50 ? "#4ade80" : soc > 25 ? "#f59e0b" : "#ef4444";

  const headerStats = (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: socColor,
            fontFamily: "var(--font-geist-mono), monospace",
            lineHeight: 1,
          }}
        >
          {Math.round(soc)}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.35)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          %
        </span>
      </div>
      <div
        style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)" }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "#a78bfa",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {latest.current != null ? latest.current.toFixed(1) : "—"}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          A
        </span>
      </div>
      <div
        style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)" }}
      />
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Home size={11} color="#f472b6" />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#f472b6",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {latest.insideTemperature != null
              ? `${latest.insideTemperature.toFixed(1)}°`
              : "—"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Sun size={11} color="#fbbf24" />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#fbbf24",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            {latest.outsideTemperature != null
              ? `${latest.outsideTemperature.toFixed(1)}°`
              : "—"}
          </span>
        </div>
      </div>
      <div
        style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Clock size={11} color="rgba(255,255,255,0.25)" />
        <span
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.3)",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          {new Date(latest.timestampMs).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </span>
      </div>
    </>
  );

  const desktopCardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    borderRadius: 24,
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow:
      "0 20px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  const desktopCardHeader = (Icon: React.ElementType, label: string) => (
    <div
      style={{
        padding: "12px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(10,10,15,0.6)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Icon size={13} color="rgba(255,255,255,0.35)" />
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.35)",
          fontFamily: "var(--font-geist-mono), monospace",
        }}
      >
        {label}
      </span>
    </div>
  );

  return (
    <>
      {/* ── Desktop grid layout ──────────────────────────────────── */}
      <div
        className="dashboard-desktop"
        style={{
          flexDirection: "column",
          minHeight: "100vh",
          background: "#0a0a0f",
        }}
      >
        {/* Top header bar */}
        <div
          style={{
            padding: "12px 20px",
            background: "rgba(10,10,15,0.95)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(20px)",
            display: "flex",
            alignItems: "center",
            gap: 20,
            position: "sticky",
            top: 0,
            zIndex: 10,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.25)",
              fontFamily: "var(--font-geist-mono), monospace",
              marginRight: 4,
            }}
          >
            {deviceId ?? "troopy-smartshunt"}
          </span>
          <div
            style={{
              width: 1,
              height: 24,
              background: "rgba(255,255,255,0.08)",
            }}
          />
          {headerStats}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: isRefreshing ? "default" : "pointer",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              color: isRefreshing ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)",
              transition: "color 0.15s ease",
            }}
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : undefined} />
          </button>
        </div>

        {/* Responsive card grid — 2-col on md, 4-col on lg+ (via globals.css) */}
        <div className="dashboard-grid">
          <div style={desktopCardStyle}>
            {desktopCardHeader(Zap, "Battery")}
            <BatteryCard
              history={history}
              latest={latest}
              hourlyData={batteryHourly}
            />
          </div>
          <div style={desktopCardStyle}>
            {desktopCardHeader(Thermometer, "Temperature")}
            <TempCard history={history} latest={latest} />
          </div>
          <div style={desktopCardStyle}>
            {desktopCardHeader(MapPin, "GPS & Travel")}
            <GpsCard
              history={history}
              gpsHistory={gpsHistory}
              deviceId={deviceId}
            />
          </div>
          <div style={desktopCardStyle}>
            {desktopCardHeader(Droplets, "Water Tank")}
            <WaterCard
              remainingL={waterRemainingL}
              remainingPct={waterRemainingPct}
              tankL={waterTankL}
              dailyUsage={waterDailyUsage}
            />
          </div>
          <div style={desktopCardStyle}>
            {desktopCardHeader(Fuel, "Fuel")}
            <FuelCard logs={fuelLogs} tankCapacityL={fuelTankCapacityL} />
          </div>
        </div>
      </div>

      {/* ── Mobile swipeable layout ──────────────────────────────── */}
      <div
        className="dashboard-mobile"
        style={{
          minHeight: "100vh",
          background: "#0a0a0f",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px 0",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 390,
            background: "rgba(255,255,255,0.03)",
            borderRadius: 32,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow:
              "0 40px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          {/* Mobile header */}
          <div
            style={{
              padding: "16px 20px 12px",
              background: "rgba(10,10,15,0.9)",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.3)",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                {deviceId ?? "troopy-smartshunt"}
              </span>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                style={{
                  background: "none",
                  border: "none",
                  cursor: isRefreshing ? "default" : "pointer",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  color: isRefreshing ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)",
                  transition: "color 0.15s ease",
                }}
              >
                <RefreshCw size={13} className={isRefreshing ? "animate-spin" : undefined} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {headerStats}
            </div>
          </div>

          {/* Tab navigation */}
          <div
            style={{
              display: "flex",
              padding: "10px 16px",
              gap: 6,
              background: "rgba(10,10,15,0.7)",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {NAV_CARDS.map((card, i) => {
              const active = activeCard === i;
              return (
                <button
                  key={card.id}
                  onClick={() => setActiveCard(i)}
                  style={{
                    flex: 1,
                    padding: "7px 4px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    background: active
                      ? "rgba(255,255,255,0.1)"
                      : "transparent",
                    color: active ? "white" : "rgba(255,255,255,0.35)",
                    fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    letterSpacing: "0.03em",
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <card.Icon size={16} />
                  {card.label}
                </button>
              );
            })}
          </div>

          {/* Swipeable cards */}
          <div
            style={{
              overflow: "hidden",
              touchAction: "pan-y",
              userSelect: "none",
            }}
            onMouseDown={(e) => handlePointerDown(e.clientX)}
            onMouseMove={(e) => handlePointerMove(e.clientX)}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={(e) => handlePointerDown(e.touches[0].clientX)}
            onTouchMove={(e) => handlePointerMove(e.touches[0].clientX)}
            onTouchEnd={handlePointerUp}
          >
            <div
              style={{
                display: "flex",
                transform: `translateX(calc(${-activeCard * 100}% + ${dragOffset}px))`,
                transition: dragging
                  ? "none"
                  : "transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)",
                willChange: "transform",
              }}
            >
              <div style={{ minWidth: "100%", minHeight: 460 }}>
                <BatteryCard
                  history={history}
                  latest={latest}
                  hourlyData={batteryHourly}
                />
              </div>
              <div style={{ minWidth: "100%", minHeight: 460 }}>
                <TempCard history={history} latest={latest} />
              </div>
              <div style={{ minWidth: "100%", minHeight: 460 }}>
                <GpsCard
                  history={history}
                  gpsHistory={gpsHistory}
                  deviceId={deviceId}
                />
              </div>
              <div style={{ minWidth: "100%", minHeight: 460 }}>
                <WaterCard
                  remainingL={waterRemainingL}
                  remainingPct={waterRemainingPct}
                  tankL={waterTankL}
                  dailyUsage={waterDailyUsage}
                />
              </div>
              <div style={{ minWidth: "100%", minHeight: 460 }}>
                <FuelCard logs={fuelLogs} tankCapacityL={fuelTankCapacityL} />
              </div>
            </div>
          </div>

          {/* Dot indicators */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 6,
              padding: "12px 0 20px",
              background: "rgba(10,10,15,0.7)",
            }}
          >
            {NAV_CARDS.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveCard(i)}
                style={{
                  width: activeCard === i ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  border: "none",
                  cursor: "pointer",
                  background:
                    activeCard === i
                      ? "rgba(255,255,255,0.7)"
                      : "rgba(255,255,255,0.2)",
                  transition: "all 0.3s ease",
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

import { Route, Gauge, Thermometer, Battery, Navigation2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Reading = {
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsValid: boolean | null;
  gpsSpeedKmph: number | null;
  insideTemperature: number | null;
  outsideTemperature: number | null;
  voltage: number | null;
  soc: number | null;
};

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeStats(readings: Reading[]) {
  let distanceKm = 0;
  let hasDistance = false;
  let topSpeed: number | null = null;
  let minInsideTemp: number | null = null;
  let maxInsideTemp: number | null = null;
  let minOutsideTemp: number | null = null;
  let maxOutsideTemp: number | null = null;
  let minVoltage: number | null = null;
  let maxVoltage: number | null = null;
  let minSoc: number | null = null;
  let maxSoc: number | null = null;
  let prevLat: number | null = null;
  let prevLon: number | null = null;

  for (const r of readings) {
    if (r.gpsValid && r.gpsLatitude !== null && r.gpsLongitude !== null) {
      if (prevLat !== null && prevLon !== null) {
        const d = haversineKm(prevLat, prevLon, r.gpsLatitude, r.gpsLongitude);
        // ignore sub-20m noise and GPS jumps > 5km between readings
        if (d >= 0.02 && d < 5) {
          distanceKm += d;
          hasDistance = true;
        }
      }
      prevLat = r.gpsLatitude;
      prevLon = r.gpsLongitude;
    }

    if (r.gpsValid && r.gpsSpeedKmph !== null) {
      topSpeed =
        topSpeed === null
          ? r.gpsSpeedKmph
          : Math.max(topSpeed, r.gpsSpeedKmph);
    }

    if (r.insideTemperature !== null) {
      minInsideTemp =
        minInsideTemp === null
          ? r.insideTemperature
          : Math.min(minInsideTemp, r.insideTemperature);
      maxInsideTemp =
        maxInsideTemp === null
          ? r.insideTemperature
          : Math.max(maxInsideTemp, r.insideTemperature);
    }

    if (r.outsideTemperature !== null) {
      minOutsideTemp =
        minOutsideTemp === null
          ? r.outsideTemperature
          : Math.min(minOutsideTemp, r.outsideTemperature);
      maxOutsideTemp =
        maxOutsideTemp === null
          ? r.outsideTemperature
          : Math.max(maxOutsideTemp, r.outsideTemperature);
    }

    if (r.voltage !== null) {
      minVoltage =
        minVoltage === null ? r.voltage : Math.min(minVoltage, r.voltage);
      maxVoltage =
        maxVoltage === null ? r.voltage : Math.max(maxVoltage, r.voltage);
    }

    if (r.soc !== null) {
      minSoc = minSoc === null ? r.soc : Math.min(minSoc, r.soc);
      maxSoc = maxSoc === null ? r.soc : Math.max(maxSoc, r.soc);
    }
  }

  return {
    distanceKm: hasDistance ? distanceKm : null,
    topSpeedKmph: topSpeed,
    minInsideTempC: minInsideTemp,
    maxInsideTempC: maxInsideTemp,
    minOutsideTempC: minOutsideTemp,
    maxOutsideTempC: maxOutsideTemp,
    minVoltage,
    maxVoltage,
    minSoc,
    maxSoc,
  };
}

function fmt(value: number | null, digits = 1) {
  return value === null ? "-" : value.toFixed(digits);
}

function fmtRange(
  min: number | null,
  max: number | null,
  digits = 1,
  unit = "",
) {
  if (min === null && max === null) return "-";
  if (min === null || max === null) return `${fmt(min ?? max, digits)}${unit}`;
  if (Math.abs(min - max) < 0.05) return `${fmt(min, digits)}${unit}`;
  return `${fmt(min, digits)} – ${fmt(max, digits)}${unit}`;
}

const cardClass =
  "rounded-[28px] border border-zinc-800/60 bg-zinc-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-sm";

type StatBlockProps = {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
};

function StatBlock({ label, icon, value, unit }: StatBlockProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-[0.16em]">
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-3xl">
        {value}
        {unit && (
          <span className="ml-1.5 text-base font-normal text-zinc-500">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

type Props = {
  readings: Reading[];
  label?: string;
};

export function DailyStats({ readings, label = "Today" }: Props) {
  const stats = computeStats(readings);

  return (
    <Card className={cardClass}>
      <CardContent className="p-6 md:p-8">
        <div className="mb-6 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </div>

        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <StatBlock
            label="Distance"
            icon={<Route className="h-4 w-4" />}
            value={
              stats.distanceKm === null
                ? "-"
                : stats.distanceKm < 1
                  ? `${(stats.distanceKm * 1000).toFixed(0)} m`
                  : `${stats.distanceKm.toFixed(1)}`
            }
            unit={
              stats.distanceKm === null || stats.distanceKm < 1
                ? undefined
                : "km"
            }
          />

          <StatBlock
            label="Top Speed"
            icon={<Gauge className="h-4 w-4" />}
            value={fmt(stats.topSpeedKmph, 0)}
            unit={stats.topSpeedKmph === null ? undefined : "km/h"}
          />

          <StatBlock
            label="Inside Temp"
            icon={<Thermometer className="h-4 w-4" />}
            value={fmtRange(stats.minInsideTempC, stats.maxInsideTempC)}
            unit={
              stats.minInsideTempC !== null || stats.maxInsideTempC !== null
                ? "°C"
                : undefined
            }
          />

          <StatBlock
            label="Outside Temp"
            icon={<Thermometer className="h-4 w-4" />}
            value={fmtRange(stats.minOutsideTempC, stats.maxOutsideTempC)}
            unit={
              stats.minOutsideTempC !== null || stats.maxOutsideTempC !== null
                ? "°C"
                : undefined
            }
          />

          <StatBlock
            label="Voltage"
            icon={<Navigation2 className="h-4 w-4" />}
            value={fmtRange(stats.minVoltage, stats.maxVoltage, 2)}
            unit={
              stats.minVoltage !== null || stats.maxVoltage !== null
                ? "V"
                : undefined
            }
          />

          <StatBlock
            label="SOC"
            icon={<Battery className="h-4 w-4" />}
            value={fmtRange(stats.minSoc, stats.maxSoc, 0)}
            unit={stats.minSoc !== null || stats.maxSoc !== null ? "%" : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}

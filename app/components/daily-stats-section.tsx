"use client";

import { useMemo, useState } from "react";
import { DailyStats } from "./daily-stats";

export type DailyStatsReading = {
  timestampMs: number;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsValid: boolean | null;
  gpsSpeedKmph: number | null;
  insideTemperature: number | null;
  outsideTemperature: number | null;
  soc: number | null;
};

function utcDayKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function dayLabel(key: string, todayKey: string): string {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ky, km, kd] = key.split("-").map(Number);
  const diffMs = Date.UTC(ty, tm - 1, td) - Date.UTC(ky, km - 1, kd);
  const diff = Math.round(diffMs / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(Date.UTC(ky, km - 1, kd));
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function DailyStatsSection({ readings }: { readings: DailyStatsReading[] }) {
  const todayKey = utcDayKey(Date.now());

  const availableDays = useMemo(() => {
    const seen = new Set<string>();
    for (const r of readings) seen.add(utcDayKey(r.timestampMs));
    return [...seen].sort((a, b) => (a < b ? 1 : -1));
  }, [readings]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedDay = availableDays[selectedIndex] ?? todayKey;

  const canGoBack = selectedIndex < availableDays.length - 1;
  const canGoForward = selectedIndex > 0;

  const dayReadings = useMemo(
    () =>
      readings
        .filter((r) => utcDayKey(r.timestampMs) === selectedDay)
        .sort((a, b) => a.timestampMs - b.timestampMs),
    [readings, selectedDay],
  );

  return (
    <DailyStats
      readings={dayReadings}
      label={dayLabel(selectedDay, todayKey)}
      onPrev={() => setSelectedIndex((i) => i + 1)}
      onNext={() => setSelectedIndex((i) => i - 1)}
      canGoPrev={canGoBack}
      canGoNext={canGoForward}
    />
  );
}

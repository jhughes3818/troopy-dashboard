"use client";

import { useEffect, useState } from "react";

type LocalSampleTimeProps = {
  timestampMs: number | string | null;
};

function formatLocalTime(value: number | string | null) {
  if (value === null) return "-";

  const date = new Date(Number(value));

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatLocalDate(value: number | string | null) {
  if (value === null) return "-";

  const date = new Date(Number(value));

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatLocalTimeZone(value: number | string | null) {
  if (value === null) return "-";

  const date = new Date(Number(value));
  const parts = new Intl.DateTimeFormat([], {
    timeZoneName: "short",
  }).formatToParts(date);

  return parts.find((part) => part.type === "timeZoneName")?.value ?? "Local";
}

export function LocalSampleTime({ timestampMs }: LocalSampleTimeProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const timeText = mounted ? formatLocalTime(timestampMs) : "--:--";
  const dateText = mounted ? formatLocalDate(timestampMs) : "--- --";
  const timeZoneText = mounted ? formatLocalTimeZone(timestampMs) : "Local";

  return (
    <>
      <div className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-200 md:text-3xl">
        {timeText}
      </div>
      <div className="mt-1 text-sm text-zinc-500">
        {dateText} · {timeZoneText}
      </div>
    </>
  );
}
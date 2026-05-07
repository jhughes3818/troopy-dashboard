"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type AutoRefreshProps = {
  intervalMs?: number;
};

export function AutoRefresh({ intervalMs = 5000 }: AutoRefreshProps) {
  const router = useRouter();
  const lastTimestampRef = useRef<string | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(async () => {
      try {
        const res = await fetch("/api/victron/latest");
        if (!res.ok) return;
        const data = await res.json();
        const ts: string | null = data.reading?.timestampMs ?? null;
        if (ts !== null && ts !== lastTimestampRef.current) {
          lastTimestampRef.current = ts;
          router.refresh();
        }
      } catch {
        // network error — skip this tick
      }
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [intervalMs, router]);

  return null;
}

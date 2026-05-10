import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";

export const runtime = "nodejs";

const DEFAULT_DEVICE_ID = "troopy-smartshunt";
const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_LOOKBACK_DAYS = 14;

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function parsePositiveNumber(value: string | null) {
  if (!value) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type SerializedWeatherReading = {
  id: string;
  deviceId: string;
  latitude: number;
  longitude: number;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  precipitationMm: number | null;
  cloudCoverPercent: number | null;
  pressureHpa: number | null;
  source: string | null;
  sourceTimestampMs: string | null;
  fetchedAt: string;
};

function serializeWeatherReading(
  reading: Awaited<ReturnType<typeof prisma.weatherReading.findMany>>[number],
): SerializedWeatherReading {
  return {
    ...reading,
    sourceTimestampMs: reading.sourceTimestampMs?.toString() ?? null,
    fetchedAt: reading.fetchedAt.toISOString(),
  };
}

const getCachedWeatherReadings = unstable_cache(
  async (deviceId: string, fromMs: number, toMs: number) => {
    const readings = await prisma.weatherReading.findMany({
      where: {
        deviceId,
        OR: [
          {
            sourceTimestampMs: {
              gte: BigInt(fromMs),
              lte: BigInt(toMs),
            },
          },
          {
            sourceTimestampMs: null,
            fetchedAt: {
              gte: new Date(fromMs),
              lte: new Date(toMs),
            },
          },
        ],
      },
      orderBy: [
        {
          sourceTimestampMs: "asc",
        },
        {
          fetchedAt: "asc",
        },
      ],
    });

    return readings.map(serializeWeatherReading);
  },
  ["weather-readings"],
  {
    revalidate: 5 * 60,
  },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const deviceId = searchParams.get("deviceId") || DEFAULT_DEVICE_ID;
  const fromParam = parsePositiveNumber(searchParams.get("from"));
  const toParam = parsePositiveNumber(searchParams.get("to"));

  const nowMs = Date.now();
  const toMs = toParam ?? nowMs;
  const defaultFromMs = toMs - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
  const fromMs = fromParam ?? defaultFromMs;
  const maxFromMs = toMs - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  if (fromMs > toMs) {
    return jsonError("from must be earlier than or equal to to.", 400);
  }

  if (fromMs < maxFromMs) {
    return jsonError(
      `Date range is too large. Maximum lookback is ${MAX_LOOKBACK_DAYS} days.`,
      400,
    );
  }

  const bucketMs = 5 * 60 * 1000;
  const bucketedFrom = Math.floor(fromMs / bucketMs) * bucketMs;
  const bucketedTo = Math.floor(toMs / bucketMs) * bucketMs;

  const readings = await getCachedWeatherReadings(deviceId, bucketedFrom, bucketedTo);

  return NextResponse.json(
    {
      ok: true,
      deviceId,
      fromMs,
      toMs,
      count: readings.length,
      readings,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    },
  );
}

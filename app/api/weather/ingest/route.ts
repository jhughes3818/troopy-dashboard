import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type WeatherIngestBody = {
  deviceId?: string;
  latitude?: number;
  longitude?: number;
  timestampMs?: number;
};

type OpenMeteoCurrentWeather = {
  time?: string;
  temperature_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  cloud_cover?: number;
  pressure_msl?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
};

type OpenMeteoResponse = {
  current?: OpenMeteoCurrentWeather;
};

const INGEST_SECRET_HEADER = "x-ingest-secret";
const DEFAULT_DEVICE_ID = "troopy-smartshunt";
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function parseSourceTimestampMs(
  openMeteoTime: string | undefined,
  fallbackTimestampMs: number,
) {
  if (!openMeteoTime) return fallbackTimestampMs;

  const parsed = Date.parse(openMeteoTime);
  return Number.isFinite(parsed) ? parsed : fallbackTimestampMs;
}

export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.WEATHER_INGEST_SECRET ?? process.env.INGEST_SECRET;

  if (!expectedSecret) {
    return jsonError("Weather ingest secret is not configured.", 500);
  }

  const providedSecret = request.headers.get(INGEST_SECRET_HEADER);

  if (providedSecret !== expectedSecret) {
    return jsonError("Unauthorized.", 401);
  }

  let body: WeatherIngestBody;

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const deviceId = body.deviceId || DEFAULT_DEVICE_ID;
  const latitude = body.latitude;
  const longitude = body.longitude;
  const timestampMs = body.timestampMs ?? Date.now();

  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return jsonError("latitude must be a number between -90 and 90.", 400);
  }

  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return jsonError("longitude must be a number between -180 and 180.", 400);
  }

  if (!isFiniteNumber(timestampMs) || timestampMs <= 0) {
    return jsonError("timestampMs must be a positive number.", 400);
  }

  const existing = await prisma.weatherReading.findFirst({
    where: {
      deviceId,
      sourceTimestampMs: {
        gte: BigInt(timestampMs - DUPLICATE_WINDOW_MS),
        lte: BigInt(timestampMs + DUPLICATE_WINDOW_MS),
      },
    },
    orderBy: {
      fetchedAt: "desc",
    },
  });

  if (existing) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Weather reading already exists for this time window.",
      reading: existing,
    });
  }

  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", latitude.toString());
  weatherUrl.searchParams.set("longitude", longitude.toString());
  weatherUrl.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "precipitation",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
    ].join(","),
  );
  weatherUrl.searchParams.set("wind_speed_unit", "kmh");
  weatherUrl.searchParams.set("timezone", "UTC");

  let weatherData: OpenMeteoResponse;

  try {
    const response = await fetch(weatherUrl, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      return jsonError(
        `Weather provider request failed with HTTP ${response.status}: ${responseText}`,
        502,
      );
    }

    weatherData = (await response.json()) as OpenMeteoResponse;
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? `Weather provider request failed: ${error.message}`
        : "Weather provider request failed.",
      502,
    );
  }

  const current = weatherData.current;

  if (!current) {
    return jsonError(
      "Weather provider response did not include current weather data.",
      502,
    );
  }

  const sourceTimestampMs = parseSourceTimestampMs(current.time, timestampMs);

  const reading = await prisma.weatherReading.create({
    data: {
      deviceId,
      latitude,
      longitude,
      windSpeedKmh: current.wind_speed_10m ?? null,
      windDirectionDeg: current.wind_direction_10m ?? null,
      windGustKmh: current.wind_gusts_10m ?? null,
      temperatureC: current.temperature_2m ?? null,
      apparentTemperatureC: current.apparent_temperature ?? null,
      precipitationMm: current.precipitation ?? null,
      cloudCoverPercent: current.cloud_cover ?? null,
      pressureHpa: current.pressure_msl ?? null,
      source: "open-meteo",
      sourceTimestampMs: BigInt(sourceTimestampMs),
    },
  });

  return NextResponse.json({ ok: true, reading });
}

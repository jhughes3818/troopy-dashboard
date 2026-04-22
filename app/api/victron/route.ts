import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseTelemetryPayload,
  serializeReadings,
  serializeReading,
} from "@/lib/telemetry";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
export const dynamic = "force-dynamic";

function getLimitFromQuery(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (rawLimit === null) return DEFAULT_LIMIT;

  const parsedLimit = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) return DEFAULT_LIMIT;

  return Math.min(parsedLimit, MAX_LIMIT);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed JSON body." },
      { status: 400 },
    );
  }

  const parsedPayload = parseTelemetryPayload(body);
  if (!parsedPayload.ok) {
    return NextResponse.json(
      { ok: false, error: parsedPayload.error },
      { status: 400 },
    );
  }

  const payload = parsedPayload.data;
  const reading = await prisma.telemetryReading.create({
    data: {
      deviceId: payload.device_id,
      voltage: payload.voltage,
      current: payload.current,
      soc: payload.soc,
      power: payload.power,
      auxVoltage: payload.aux_voltage,
      ttgDays: payload.ttg_days,
      timestampMs: BigInt(payload.timestamp_ms),
    },
  });

  return NextResponse.json({
    ok: true,
    reading: serializeReading(reading),
  });
}

export async function GET(request: NextRequest) {
  const limit = getLimitFromQuery(request);
  const readings = await prisma.telemetryReading.findMany({
    orderBy: { receivedAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    ok: true,
    readings: serializeReadings(readings),
  });
}

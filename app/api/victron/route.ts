import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  MAX_REQUEST_BYTES,
  parseBatchTelemetryPayload,
  parseTelemetryPayload,
  serializeReadings,
  serializeReading,
} from "@/lib/telemetry";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const configuredKey = process.env.INGEST_API_KEY;
  if (!configuredKey) {
    return { ok: false, status: 500, error: "Server ingest key is not configured." };
  }

  const suppliedKey = request.headers.get("x-ingest-key");
  if (suppliedKey !== configuredKey) {
    return { ok: false, status: 401, error: "Unauthorized ingest key." };
  }

  return { ok: true };
}

function getLimitFromQuery(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (rawLimit === null) return DEFAULT_LIMIT;

  const parsedLimit = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) return DEFAULT_LIMIT;

  return Math.min(parsedLimit, MAX_LIMIT);
}

export async function POST(request: NextRequest) {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.` },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed JSON body." },
      { status: 400 },
    );
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "records" in body
  ) {
    const parsedBatch = parseBatchTelemetryPayload(body);
    if (!parsedBatch.ok) {
      return NextResponse.json(
        { ok: false, error: parsedBatch.error },
        { status: 400 },
      );
    }

    if (parsedBatch.data.records.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Batch has no valid telemetry records.",
          rejected: parsedBatch.data.rejected,
          errors: parsedBatch.data.errors,
        },
        { status: 400 },
      );
    }

    const data = parsedBatch.data.records.map((record) => ({
      deviceId: record.device_id,
      voltage: record.voltage,
      current: record.current,
      soc: record.soc,
      power: record.power,
      auxVoltage: record.aux_voltage,
      ttgDays: record.ttg_days,
      timestampMs: BigInt(record.timestamp_ms),
    }));

    const insertResult = await prisma.telemetryReading.createMany({
      data,
      skipDuplicates: true,
    });

    const accepted = insertResult.count;
    const duplicates = parsedBatch.data.records.length - accepted;
    return NextResponse.json({
      ok: true,
      mode: "batch",
      accepted,
      duplicates,
      rejected: parsedBatch.data.rejected,
      errors: parsedBatch.data.errors,
    });
  }

  const parsedSingle = parseTelemetryPayload(body);
  if (!parsedSingle.ok) {
    return NextResponse.json(
      { ok: false, error: parsedSingle.error },
      { status: 400 },
    );
  }

  const payload = parsedSingle.data;
  const data = {
    deviceId: payload.device_id,
    voltage: payload.voltage,
    current: payload.current,
    soc: payload.soc,
    power: payload.power,
    auxVoltage: payload.aux_voltage,
    ttgDays: payload.ttg_days,
    timestampMs: BigInt(payload.timestamp_ms),
  };

  const insertResult = await prisma.telemetryReading.createMany({
    data: [data],
    skipDuplicates: true,
  });
  const duplicate = insertResult.count === 0;
  const reading = await prisma.telemetryReading.findUniqueOrThrow({
    where: {
      deviceId_timestampMs: {
        deviceId: data.deviceId,
        timestampMs: data.timestampMs,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    mode: "single",
    accepted: duplicate ? 0 : 1,
    duplicates: duplicate ? 1 : 0,
    rejected: 0,
    errors: [],
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

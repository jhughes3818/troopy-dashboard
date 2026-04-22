import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

type InsertTelemetryData = {
  deviceId: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  auxVoltage: number | null;
  ttgDays: number | null;
  timestampMs: bigint;
};

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

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function findReadingByIdentity(data: InsertTelemetryData) {
  return prisma.telemetryReading.findFirst({
    where: {
      deviceId: data.deviceId,
      timestampMs: data.timestampMs,
    },
    orderBy: { receivedAt: "desc" },
  });
}

async function createOrFindReading(data: InsertTelemetryData) {
  try {
    const reading = await prisma.telemetryReading.create({ data });
    return { reading, duplicate: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const reading = await findReadingByIdentity(data);
    if (!reading) {
      throw error;
    }
    return { reading, duplicate: true };
  }
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

    let accepted = 0;
    let duplicates = 0;
    for (const record of data) {
      const result = await createOrFindReading(record);
      if (result.duplicate) {
        duplicates += 1;
      } else {
        accepted += 1;
      }
    }

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

  const { reading, duplicate } = await createOrFindReading(data);

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

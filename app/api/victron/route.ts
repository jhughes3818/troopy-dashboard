import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  MAX_REQUEST_BYTES,
  parseBatchTelemetryPayload,
  parseTelemetryPayload,
  serializeReadings,
  serializeReading,
} from "@/lib/telemetry";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
export const dynamic = "force-dynamic";

type InsertTelemetryData = {
  deviceId: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  auxVoltage: number | null;
  ttgDays: number | null;
  insideTempC: number | null;
  outsideTempC: number | null;
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

function mapRecordToInsertData(record: {
  device_id: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  aux_voltage: number | null;
  ttg_days: number | null;
  inside_temp_c?: number | null;
  outside_temp_c?: number | null;
  timestamp_ms: number;
}): InsertTelemetryData {
  return {
    deviceId: record.device_id,
    voltage: record.voltage,
    current: record.current,
    soc: record.soc,
    power: record.power,
    auxVoltage: record.aux_voltage,
    ttgDays: record.ttg_days,
    insideTempC: record.inside_temp_c ?? null,
    outsideTempC: record.outside_temp_c ?? null,
    timestampMs: BigInt(record.timestamp_ms),
  };
}

function dedupeBatch(records: InsertTelemetryData[]) {
  const seen = new Set<string>();
  const unique: InsertTelemetryData[] = [];
  let duplicateCount = 0;

  for (const record of records) {
    const key = `${record.deviceId}:${record.timestampMs.toString()}`;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(record);
  }

  return { unique, duplicateCount };
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

  if (typeof body === "object" && body !== null && "records" in body) {
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

    const mappedRecords = parsedBatch.data.records.map(mapRecordToInsertData);
    const { unique, duplicateCount: duplicatesInPayload } = dedupeBatch(mappedRecords);

    const result = await prisma.telemetryReading.createMany({
      data: unique,
      skipDuplicates: true as never,
    });

    const inserted = result.count;
    const duplicatesAlreadyInDb = unique.length - inserted;
    const duplicates = duplicatesInPayload + duplicatesAlreadyInDb;

    return NextResponse.json({
      ok: true,
      mode: "batch",
      accepted: inserted,
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
  const data = mapRecordToInsertData(payload);

  const result = await prisma.telemetryReading.createMany({
    data: [data],
    skipDuplicates: true as never,
  });

  const accepted = result.count;
  const duplicates = accepted === 0 ? 1 : 0;

  const reading = await prisma.telemetryReading.findFirst({
    where: {
      deviceId: data.deviceId,
      timestampMs: data.timestampMs,
    },
    orderBy: { timestampMs: "desc" },
  });

  return NextResponse.json({
    ok: true,
    mode: "single",
    accepted,
    duplicates,
    rejected: 0,
    errors: [],
    reading: reading ? serializeReading(reading) : null,
  });
}

export async function GET(request: NextRequest) {
  const limit = getLimitFromQuery(request);

  const readings = await prisma.telemetryReading.findMany({
    orderBy: { timestampMs: "desc" },
    take: limit,
  });

  return NextResponse.json({
    ok: true,
    readings: serializeReadings(readings),
  });
}
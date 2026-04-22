export type RawTelemetryPayload = {
  device_id: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  aux_voltage: number | null;
  ttg_days: number | null;
  timestamp_ms: number;
};

type ParseTelemetryResult =
  | { ok: true; data: RawTelemetryPayload }
  | { ok: false; error: string };

const NULLABLE_NUMERIC_FIELDS = [
  "voltage",
  "current",
  "soc",
  "power",
  "aux_voltage",
  "ttg_days",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNullableNumber(
  payload: Record<string, unknown>,
  key: (typeof NULLABLE_NUMERIC_FIELDS)[number],
): number | null | undefined {
  const value = payload[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function parseTelemetryPayload(body: unknown): ParseTelemetryResult {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }

  if (typeof body.device_id !== "string" || body.device_id.trim().length === 0) {
    return { ok: false, error: "device_id must be a non-empty string." };
  }

  const parsedFields = {} as Pick<
    RawTelemetryPayload,
    (typeof NULLABLE_NUMERIC_FIELDS)[number]
  >;
  for (const field of NULLABLE_NUMERIC_FIELDS) {
    const parsed = parseNullableNumber(body, field);
    if (parsed === undefined) {
      return { ok: false, error: `${field} must be a number or null.` };
    }
    parsedFields[field] = parsed;
  }

  if (
    typeof body.timestamp_ms !== "number" ||
    !Number.isFinite(body.timestamp_ms) ||
    !Number.isInteger(body.timestamp_ms)
  ) {
    return { ok: false, error: "timestamp_ms must be an integer number." };
  }

  return {
    ok: true,
    data: {
      device_id: body.device_id.trim(),
      ...parsedFields,
      timestamp_ms: body.timestamp_ms,
    },
  };
}

type ReadingWithBigInt = {
  id: string;
  deviceId: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  auxVoltage: number | null;
  ttgDays: number | null;
  timestampMs: bigint;
  receivedAt: Date;
};

export function serializeReading(reading: ReadingWithBigInt) {
  return {
    ...reading,
    timestampMs: Number(reading.timestampMs),
  };
}

export function serializeReadings(readings: ReadingWithBigInt[]) {
  return readings.map(serializeReading);
}

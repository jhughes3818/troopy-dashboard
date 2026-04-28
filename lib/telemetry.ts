export type RawTelemetryPayload = {
  device_id: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  power: number | null;
  aux_voltage: number | null;
  ttg_days: number | null;
  inside_temp_c: number | null;
  outside_temp_c: number | null;
  gps_valid: boolean | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_altitude_m: number | null;
  gps_speed_kmph: number | null;
  gps_course_deg: number | null;
  gps_satellites: number | null;
  gps_hdop: number | null;
  gps_fix_age_ms: number | null;
  timestamp_ms: number;
};

export type BatchTelemetryError = {
  index: number;
  error: string;
};

type ParseTelemetryResult =
  | { ok: true; data: RawTelemetryPayload }
  | { ok: false; error: string };

type ParseBatchTelemetryResult =
  | {
      ok: true;
      data: {
        records: RawTelemetryPayload[];
        rejected: number;
        errors: BatchTelemetryError[];
      };
    }
  | { ok: false; error: string };

const NULLABLE_NUMERIC_FIELDS = [
  "voltage",
  "current",
  "soc",
  "power",
  "aux_voltage",
  "ttg_days",
  "inside_temp_c",
  "outside_temp_c",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude_m",
  "gps_speed_kmph",
  "gps_course_deg",
  "gps_satellites",
  "gps_hdop",
  "gps_fix_age_ms",
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

  let gpsValid: boolean | null;
  if (body.gps_valid === null) {
    gpsValid = null;
  } else if (typeof body.gps_valid === "boolean") {
    gpsValid = body.gps_valid;
  } else {
    return { ok: false, error: "gps_valid must be a boolean or null." };
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
      gps_valid: gpsValid,
      timestamp_ms: body.timestamp_ms,
    },
  };
}

export const MAX_BATCH_RECORDS = 100;
export const MAX_REQUEST_BYTES = 1_000_000;

export function parseBatchTelemetryPayload(body: unknown): ParseBatchTelemetryResult {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }

  const records = body.records;
  if (!Array.isArray(records)) {
    return { ok: false, error: "records must be an array." };
  }

  if (records.length === 0) {
    return { ok: false, error: "records must contain at least one item." };
  }

  if (records.length > MAX_BATCH_RECORDS) {
    return {
      ok: false,
      error: `records cannot exceed ${MAX_BATCH_RECORDS} items per request.`,
    };
  }

  const validRecords: RawTelemetryPayload[] = [];
  const errors: BatchTelemetryError[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const parsed = parseTelemetryPayload(records[index]);
    if (parsed.ok) {
      validRecords.push(parsed.data);
      continue;
    }
    errors.push({ index, error: parsed.error });
  }

  return {
    ok: true,
    data: {
      records: validRecords,
      rejected: errors.length,
      errors,
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
  insideTempC: number | null;
  outsideTempC: number | null;
  gpsValid: boolean | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAltitudeM: number | null;
  gpsSpeedKmph: number | null;
  gpsCourseDeg: number | null;
  gpsSatellites: number | null;
  gpsHdop: number | null;
  gpsFixAgeMs: number | null;
  timestampMs: bigint;
  receivedAt: Date;
};

export function serializeReading(reading: ReadingWithBigInt) {
  return {
    ...reading,
    insideTemperature: reading.insideTempC,
    outsideTemperature: reading.outsideTempC,
    timestampMs: Number(reading.timestampMs),
  };
}

export function serializeReadings(readings: ReadingWithBigInt[]) {
  return readings.map(serializeReading);
}

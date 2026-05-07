import { prisma } from "./prisma";

function truncateToHour(ms: number): Date {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function min(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length ? Math.min(...valid) : null;
}

function maxVal(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length ? Math.max(...valid) : null;
}

export async function aggregateHourlyBuckets(since?: Date): Promise<number> {
  const nowHour = truncateToHour(Date.now());

  let startFrom: Date;
  if (since) {
    startFrom = truncateToHour(since.getTime());
  } else {
    const latest = await prisma.telemetryHourly.findFirst({
      orderBy: { hourBucket: "desc" },
      select: { hourBucket: true },
    });
    if (latest) {
      // Re-process the last bucket in case it was incomplete, then move forward
      startFrom = new Date(latest.hourBucket.getTime() - 60 * 60 * 1000);
    } else {
      const oldest = await prisma.telemetryReading.findFirst({
        orderBy: { timestampMs: "asc" },
        select: { timestampMs: true },
      });
      if (!oldest) return 0;
      startFrom = truncateToHour(Number(oldest.timestampMs));
    }
  }

  // Fetch all raw readings in the range, excluding the current (incomplete) hour
  const readings = await prisma.telemetryReading.findMany({
    where: {
      timestampMs: {
        gte: BigInt(startFrom.getTime()),
        lt: BigInt(nowHour.getTime()),
      },
    },
    orderBy: { timestampMs: "asc" },
  });

  if (readings.length === 0) return 0;

  // Group by (deviceId, hourBucket)
  const buckets = new Map<string, typeof readings>();
  for (const r of readings) {
    const bucket = truncateToHour(Number(r.timestampMs));
    const key = `${r.deviceId}::${bucket.toISOString()}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  let written = 0;
  for (const [key, rows] of buckets) {
    const [deviceId, isoHour] = key.split("::");
    const hourBucket = new Date(isoHour);

    const data = {
      sampleCount: rows.length,
      voltage: avg(rows.map((r) => r.voltage)),
      current: avg(rows.map((r) => r.current)),
      soc: avg(rows.map((r) => r.soc)),
      power: avg(rows.map((r) => r.power)),
      auxVoltage: avg(rows.map((r) => r.auxVoltage)),
      ttgDays: avg(rows.map((r) => r.ttgDays)),
      insideTempC: avg(rows.map((r) => r.insideTempC)),
      outsideTempC: avg(rows.map((r) => r.outsideTempC)),
      fridgeTempC: avg(rows.map((r) => r.fridgeTempC)),
      gpsLatitude: avg(rows.map((r) => r.gpsLatitude)),
      gpsLongitude: avg(rows.map((r) => r.gpsLongitude)),
      gpsSpeedKmph: avg(rows.map((r) => r.gpsSpeedKmph)),
      waterFlowMlMin: avg(rows.map((r) => r.waterFlowMlMin)),
      socMin: min(rows.map((r) => r.soc)),
      voltageMin: min(rows.map((r) => r.voltage)),
      waterCumulativeMl: maxVal(rows.map((r) => r.waterCumulativeMl)),
    };

    await prisma.telemetryHourly.upsert({
      where: { deviceId_hourBucket: { deviceId, hourBucket } },
      create: { deviceId, hourBucket, ...data },
      update: data,
    });
    written++;
  }

  return written;
}

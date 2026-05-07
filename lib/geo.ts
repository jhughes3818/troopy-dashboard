import { prisma } from "@/lib/prisma";

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function computeGpsDistanceKm(startMs: number, endMs: number): Promise<number | null> {
  const readings = await prisma.telemetryReading.findMany({
    where: {
      gpsValid: true,
      gpsLatitude: { not: null },
      gpsLongitude: { not: null },
      timestampMs: { gte: BigInt(Math.floor(startMs)), lte: BigInt(Math.floor(endMs)) },
    },
    orderBy: { timestampMs: "asc" },
    select: { gpsLatitude: true, gpsLongitude: true },
  });

  if (readings.length < 2) return null;

  let total = 0;
  let hasDistance = false;
  let prev: { gpsLatitude: number; gpsLongitude: number } | null = null;

  for (const r of readings) {
    if (r.gpsLatitude === null || r.gpsLongitude === null) continue;
    if (prev) {
      const d = haversineKm(prev.gpsLatitude, prev.gpsLongitude, r.gpsLatitude, r.gpsLongitude);
      if (d >= 0.02 && d < 5) { total += d; hasDistance = true; }
    }
    prev = r as { gpsLatitude: number; gpsLongitude: number };
  }

  return hasDistance ? total : null;
}

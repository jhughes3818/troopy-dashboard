import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeReading } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function GET() {
  const reading = await prisma.telemetryReading.findFirst({
    orderBy: { receivedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    reading: reading ? serializeReading(reading) : null,
  });
}

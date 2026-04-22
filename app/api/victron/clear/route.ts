import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "This endpoint is only available in development." },
      { status: 403 },
    );
  }

  await prisma.telemetryReading.deleteMany();

  return NextResponse.json({ ok: true });
}

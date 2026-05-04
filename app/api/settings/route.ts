import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await prisma.vehicleProfile.findUnique({ where: { id: "vehicle" } });
  return NextResponse.json({ ok: true, profile });
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const tankCapacityL = typeof b.tankCapacityL === "number" ? b.tankCapacityL : null;

  if (tankCapacityL === null || tankCapacityL <= 0) {
    return NextResponse.json(
      { ok: false, error: "tankCapacityL must be a positive number." },
      { status: 400 },
    );
  }

  const profile = await prisma.vehicleProfile.upsert({
    where: { id: "vehicle" },
    update: { tankCapacityL },
    create: { id: "vehicle", tankCapacityL },
  });

  return NextResponse.json({ ok: true, profile });
}

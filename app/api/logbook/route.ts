import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await prisma.fuelLog.findMany({
    orderBy: { filledAt: "asc" },
  });
  return NextResponse.json({ ok: true, entries });
}

export async function POST(request: NextRequest) {
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

  const filledAt = typeof b.filledAt === "string" ? new Date(b.filledAt) : null;
  if (!filledAt || isNaN(filledAt.getTime())) {
    return NextResponse.json({ ok: false, error: "filledAt must be a valid ISO date string." }, { status: 400 });
  }

  const litres = typeof b.litres === "number" ? b.litres : null;
  if (litres === null || litres <= 0) {
    return NextResponse.json({ ok: false, error: "litres must be a positive number." }, { status: 400 });
  }

  const isFull = typeof b.isFull === "boolean" ? b.isFull : false;
  const distanceKm = typeof b.distanceKm === "number" && b.distanceKm > 0 ? b.distanceKm : null;
  const pricePerL = typeof b.pricePerL === "number" && b.pricePerL > 0 ? b.pricePerL : null;
  const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;

  const entry = await prisma.fuelLog.create({
    data: { filledAt, litres, isFull, distanceKm, pricePerL, notes },
  });

  return NextResponse.json({ ok: true, entry }, { status: 201 });
}

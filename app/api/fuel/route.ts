import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await prisma.fuelLog.findMany({ orderBy: { filledAt: "desc" } });
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

  const litres = typeof b.litres === "number" ? b.litres : parseFloat(b.litres as string);
  if (!isFinite(litres) || litres <= 0) {
    return NextResponse.json({ ok: false, error: "litres must be a positive number." }, { status: 400 });
  }

  const filledAt = typeof b.filledAt === "string" ? new Date(b.filledAt) : new Date();
  if (isNaN(filledAt.getTime())) {
    return NextResponse.json({ ok: false, error: "filledAt must be a valid ISO date string." }, { status: 400 });
  }

  const isFull = b.isFull === true;
  const pricePerL = typeof b.pricePerL === "number" && isFinite(b.pricePerL) ? b.pricePerL : null;
  const distanceKm = typeof b.distanceKm === "number" && isFinite(b.distanceKm) && b.distanceKm > 0 ? b.distanceKm : null;
  const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;

  const entry = await prisma.fuelLog.create({
    data: { filledAt, litres, isFull, pricePerL, distanceKm, notes },
  });

  revalidatePath("/");
  return NextResponse.json({ ok: true, entry }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await prisma.waterLog.findMany({
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

  const notes = typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null;

  const entry = await prisma.waterLog.create({
    data: { filledAt, notes },
  });

  revalidateTag("water-estimate", "max");
  return NextResponse.json({ ok: true, entry }, { status: 201 });
}

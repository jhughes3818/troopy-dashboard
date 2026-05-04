import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    await prisma.fuelLog.delete({ where: { id } });
  } catch {
    return NextResponse.json({ ok: false, error: "Entry not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

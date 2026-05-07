import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    await prisma.waterLog.delete({ where: { id } });
  } catch {
    return NextResponse.json({ ok: false, error: "Entry not found." }, { status: 404 });
  }

  revalidateTag("water-estimate", "max");
  return NextResponse.json({ ok: true });
}

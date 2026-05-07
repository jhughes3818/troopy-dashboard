import { NextRequest, NextResponse } from "next/server";
import { aggregateHourlyBuckets } from "@/lib/aggregate";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const configuredKey = process.env.INGEST_API_KEY;
  if (!configuredKey) {
    return NextResponse.json({ ok: false, error: "Server ingest key is not configured." }, { status: 500 });
  }
  if (request.headers.get("x-ingest-key") !== configuredKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  if (sinceParam && isNaN(since!.getTime())) {
    return NextResponse.json({ ok: false, error: "Invalid since date." }, { status: 400 });
  }

  const bucketsWritten = await aggregateHourlyBuckets(since);
  return NextResponse.json({ ok: true, bucketsWritten });
}

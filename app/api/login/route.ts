

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "dashboard_auth";

export async function POST(request: NextRequest) {
  try {
    const { passcode } = await request.json();

    const correctPasscode = process.env.DASHBOARD_PASSCODE;

    if (!correctPasscode) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    if (!passcode || passcode !== correctPasscode) {
      return NextResponse.json(
        { error: "Invalid passcode" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ success: true });

    response.cookies.set({
      name: COOKIE_NAME,
      value: "authenticated",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import {
  SITE_AUTH_COOKIE_MAX_AGE,
  SITE_AUTH_COOKIE_NAME,
  computeSiteAuthToken,
} from "@/lib/siteAuth";

export async function POST(request: NextRequest) {
  const user = process.env.SITE_AUTH_USERNAME;
  const pass = process.env.SITE_AUTH_PASSWORD;

  if (!user || !pass) {
    return NextResponse.json({ success: true });
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400 },
    );
  }

  if (body.username !== user || body.password !== pass) {
    return NextResponse.json(
      { success: false, error: "Incorrect username or password" },
      { status: 401 },
    );
  }

  const token = await computeSiteAuthToken(user, pass);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SITE_AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_AUTH_COOKIE_MAX_AGE,
  });

  return response;
}

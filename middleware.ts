import { NextRequest, NextResponse } from "next/server";
import {
  SITE_AUTH_API_PATH,
  SITE_AUTH_BASE_PATH,
  SITE_AUTH_COOKIE_MAX_AGE,
  SITE_AUTH_COOKIE_NAME,
  SITE_AUTH_LOGIN_PATH,
  SITE_AUTH_LOGIN_URL,
  computeSiteAuthToken,
} from "@/lib/siteAuth";

export async function middleware(request: NextRequest) {
  // request.nextUrl.pathname has the configured basePath ("/sih") already
  // stripped off - unlike the matcher config below or a redirect Location,
  // both of which need it included.
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname.endsWith("/favicon.ico") ||
    pathname === SITE_AUTH_LOGIN_PATH ||
    pathname === SITE_AUTH_API_PATH
  ) {
    return NextResponse.next();
  }

  const user = process.env.SITE_AUTH_USERNAME;
  const pass = process.env.SITE_AUTH_PASSWORD;

  // If credentials aren't configured, don't lock everyone out.
  if (!user || !pass) {
    return NextResponse.next();
  }

  const expectedToken = await computeSiteAuthToken(user, pass);

  const cookieToken = request.cookies.get(SITE_AUTH_COOKIE_NAME)?.value;
  if (cookieToken === expectedToken) {
    return NextResponse.next();
  }

  // Fallback for non-browser clients (curl -u, uptime checks, CI) that send
  // credentials directly rather than going through the login page.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.split(" ")[1] ?? "");
    const separatorIndex = decoded.indexOf(":");
    const providedUser = decoded.slice(0, separatorIndex);
    const providedPass = decoded.slice(separatorIndex + 1);

    if (providedUser === user && providedPass === pass) {
      const response = NextResponse.next();
      response.cookies.set(SITE_AUTH_COOKIE_NAME, expectedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SITE_AUTH_COOKIE_MAX_AGE,
      });
      return response;
    }
  }

  // Deliberately no WWW-Authenticate header - that's what triggers the
  // browser's native Basic Auth popup, which re-prompts once per pending
  // unauthenticated request on first load instead of asking only once.
  // Page navigations go to our own login page instead; everything else
  // (asset/data requests missing the cookie) just gets a 401.
  if (request.headers.get("accept")?.includes("text/html")) {
    const loginUrl = new URL(SITE_AUTH_LOGIN_URL, request.url);
    const fullOriginalPath =
      pathname === "/" ? SITE_AUTH_BASE_PATH : `${SITE_AUTH_BASE_PATH}${pathname}`;
    loginUrl.searchParams.set(
      "next",
      fullOriginalPath + request.nextUrl.search,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.json(
    { success: false, error: "Authentication required" },
    { status: 401 },
  );
}

export const config = {
  matcher: "/:path*",
};

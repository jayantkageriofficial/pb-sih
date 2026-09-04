// Shared config for the site-wide pre-launch auth gate (middleware.ts +
// app/site-auth + app/api/site-auth). Kept separate from next.config.ts's
// basePath so it can be imported from edge middleware without pulling in
// the Next config module.
//
// Two path flavours are exported because Next.js is inconsistent about
// basePath here: `request.nextUrl.pathname` inside middleware has the
// basePath already stripped, but redirect targets, `matcher` config, and
// client-side `fetch()` calls all need it included.
export const SITE_AUTH_BASE_PATH = "/sih";

// App-relative (basePath-stripped) - compare against request.nextUrl.pathname.
export const SITE_AUTH_LOGIN_PATH = "/site-auth";
export const SITE_AUTH_API_PATH = "/api/site-auth";

// Full, browser-facing paths (with basePath) - use for redirect targets and
// client-side fetch() calls.
export const SITE_AUTH_LOGIN_URL = `${SITE_AUTH_BASE_PATH}${SITE_AUTH_LOGIN_PATH}`;
export const SITE_AUTH_API_URL = `${SITE_AUTH_BASE_PATH}${SITE_AUTH_API_PATH}`;

export const SITE_AUTH_COOKIE_NAME = "site_auth";
export const SITE_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Token = sha256(username:password). Anyone holding the cookie can prove
// they were told the credentials, without us needing a session store - and
// nobody can forge it without already knowing the password.
export async function computeSiteAuthToken(
  username: string,
  password: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${username}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

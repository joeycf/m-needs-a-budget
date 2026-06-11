import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { env } from "@/lib/env";

// Password gate (PRD §7 Auth): every route requires a valid signed session
// cookie except /login. Server actions are POSTs to their page's route, so
// the login action passes through with /login.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await verifySessionToken(env().APP_PASSWORD, token);

  if (pathname === "/login") {
    if (authed && request.method === "GET") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    const from = `${pathname}${search}`;
    if (request.method === "GET" && from !== "/") {
      loginUrl.searchParams.set("from", from);
    }
    // 303 turns non-GET requests (e.g. expired-session action POSTs) into a
    // plain GET of the login page instead of replaying the POST there.
    return NextResponse.redirect(loginUrl, request.method === "GET" ? 307 : 303);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals/static assets and well-known metadata
  // files. App Router pages and RSC/action requests never live under /_next.
  matcher: ["/((?!_next|favicon.ico|robots.txt|sitemap.xml).*)"],
};

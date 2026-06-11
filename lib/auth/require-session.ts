import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { env } from "@/lib/env";

// Defense in depth per Next 16 guidance: the proxy gates routes, but pages
// and server actions must verify the session themselves too — a matcher
// change or moved action can silently drop proxy coverage.
export async function requireSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(env().APP_PASSWORD, token))) {
    redirect("/login");
  }
}

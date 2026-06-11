"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createSessionToken,
  passwordsMatch,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
} from "@/lib/auth/session";
import { env } from "@/lib/env";

const loginSchema = z.object({
  password: z.string().min(1),
  from: z.string().optional(),
});

export type LoginState = { error: string } | null;

// Only same-origin absolute paths; everything else falls back to "/".
function safeRedirectPath(from: string | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) {
    return "/";
  }
  return from;
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    password: formData.get("password"),
    from: formData.get("from") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "Enter the password." };
  }

  if (!(await passwordsMatch(parsed.data.password, env().APP_PASSWORD))) {
    return { error: "Incorrect password." };
  }

  const token = await createSessionToken(
    env().APP_PASSWORD,
    Date.now() + SESSION_DURATION_MS,
  );
  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  });

  redirect(safeRedirectPath(parsed.data.from));
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

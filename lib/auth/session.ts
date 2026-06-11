// Pure session-token helpers for the APP_PASSWORD gate (PRD §7 Auth).
// Web Crypto only — no Node/Next imports — so the same code runs in the
// proxy, server actions, and Vitest, and stays unit-testable.
//
// Token format: "<expiresAtMs>.<base64url HMAC-SHA256 of expiresAtMs>".
// The HMAC key is derived from APP_PASSWORD, so changing the password
// invalidates all existing sessions.

export const SESSION_COOKIE_NAME = "mnab_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const KEY_CONTEXT = "mnab-session-v1";
const encoder = new TextEncoder();

function toBase64url(buf: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buf)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${KEY_CONTEXT}:${secret}`),
  );
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(
  secret: string,
  expiresAtMs: number,
): Promise<string> {
  const payload = String(Math.floor(expiresAtMs));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64url(signature)}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  if (!/^\d{1,15}$/.test(payload)) return false;
  const signature = fromBase64url(token.slice(dot + 1));
  if (!signature) return false;

  const key = await hmacKey(secret);
  // crypto.subtle.verify is constant-time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(payload),
  );
  if (!valid) return false;
  return Number(payload) > nowMs;
}

// Constant-time password comparison: compare SHA-256 digests (equal length)
// byte-by-byte without early exit.
export async function passwordsMatch(
  submitted: string,
  actual: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(submitted)),
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
  ]);
  const bytesA = new Uint8Array(a);
  const bytesB = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

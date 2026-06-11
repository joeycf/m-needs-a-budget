import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  passwordsMatch,
  verifySessionToken,
} from "./session";

const SECRET = "correct horse battery staple";
const HOUR = 60 * 60 * 1000;

describe("createSessionToken / verifySessionToken", () => {
  it("verifies a freshly created token", async () => {
    const token = await createSessionToken(SECRET, Date.now() + HOUR);
    expect(await verifySessionToken(SECRET, token)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(SECRET, Date.now() - 1);
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("treats expiry exactly at now as expired", async () => {
    const now = Date.now();
    const token = await createSessionToken(SECRET, now);
    expect(await verifySessionToken(SECRET, token, now)).toBe(false);
  });

  it("rejects a token whose payload was tampered with", async () => {
    const token = await createSessionToken(SECRET, Date.now() + HOUR);
    const [payload, sig] = token.split(".");
    const bumped = `${BigInt(payload) + 1n}.${sig}`;
    expect(await verifySessionToken(SECRET, bumped)).toBe(false);
  });

  it("rejects a token whose signature was tampered with or truncated", async () => {
    const token = await createSessionToken(SECRET, Date.now() + HOUR);
    const [payload, sig] = token.split(".");
    const flipped = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(await verifySessionToken(SECRET, `${payload}.${flipped}`)).toBe(false);
    expect(await verifySessionToken(SECRET, `${payload}.${sig.slice(0, -2)}`)).toBe(false);
    expect(await verifySessionToken(SECRET, `${payload}.`)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("other-password", Date.now() + HOUR);
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("rejects malformed and missing tokens", async () => {
    for (const bad of [
      undefined,
      null,
      "",
      "garbage",
      "123",
      ".sig-only",
      "not-a-number.c2ln",
      "12.34.56",
      "999999999999999999999999.c2ln", // payload longer than 15 digits
    ]) {
      expect(await verifySessionToken(SECRET, bad)).toBe(false);
    }
  });

  it("accepts a token right up to its expiry and not after", async () => {
    const exp = Date.now() + HOUR;
    const token = await createSessionToken(SECRET, exp);
    expect(await verifySessionToken(SECRET, token, exp - 1)).toBe(true);
    expect(await verifySessionToken(SECRET, token, exp + 1)).toBe(false);
  });
});

describe("passwordsMatch", () => {
  it("matches identical passwords", async () => {
    expect(await passwordsMatch("hunter2", "hunter2")).toBe(true);
    expect(await passwordsMatch("päss wörd ✓", "päss wörd ✓")).toBe(true);
  });

  it("rejects different passwords", async () => {
    expect(await passwordsMatch("hunter2", "hunter3")).toBe(false);
    expect(await passwordsMatch("", "hunter2")).toBe(false);
    expect(await passwordsMatch("hunter2", "")).toBe(false);
    expect(await passwordsMatch("hunter2 ", "hunter2")).toBe(false);
  });
});

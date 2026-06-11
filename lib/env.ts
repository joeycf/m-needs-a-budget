import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD is required"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Lazy so that importing modules (e.g. during `next build`) never throws;
// validation happens on first runtime use.
export function env(): Env {
  cached ??= envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    APP_PASSWORD: process.env.APP_PASSWORD,
  });
  return cached;
}

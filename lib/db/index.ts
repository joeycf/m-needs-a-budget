import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { env } from "@/lib/env";
import * as schema from "./schema";

// neon-serverless (WebSocket Pool) rather than neon-http: interactive
// db.transaction() is required for transfer pairs and splits (iron rules 4/8).
// Node >= 22 and Vercel provide a native WebSocket, so no ws polyfill.

function createClient() {
  const pool = new Pool({ connectionString: env().DATABASE_URL });
  return { pool, db: drizzle(pool, { schema }) };
}

let client: ReturnType<typeof createClient> | undefined;

export type Db = ReturnType<typeof createClient>["db"];

export function getDb(): Db {
  client ??= createClient();
  return client.db;
}

// For scripts (seed) that must let the process exit.
export async function closeDb(): Promise<void> {
  if (client) {
    await client.pool.end();
    client = undefined;
  }
}

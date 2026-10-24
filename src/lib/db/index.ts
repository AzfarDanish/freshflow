import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalDatabase = globalThis as typeof globalThis & {
  freshFlowPool?: Pool;
  freshFlowDrizzle?: ReturnType<typeof drizzle<typeof schema>>;
};

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. For local development, set it to your PostgreSQL connection in .env.local (see .env.example); in Replit, connect the managed database. FreshFlow does not silently fall back to local files.",
    );
  }
  if (!globalDatabase.freshFlowPool) {
    globalDatabase.freshFlowPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalDatabase.freshFlowPool;
}

export function getDatabase() {
  if (!globalDatabase.freshFlowDrizzle) {
    globalDatabase.freshFlowDrizzle = drizzle(getPool(), { schema });
  }
  return globalDatabase.freshFlowDrizzle;
}

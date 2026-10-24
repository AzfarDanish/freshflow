import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUSINESS_WORKSPACES } from "../src/lib/businesses";
import { Pool } from "pg";

type LegacyState = Record<string, unknown> & {
  products: unknown[];
  recommendations: unknown[];
  tasks: unknown[];
  activity: unknown[];
  invoiceIntakes?: unknown[];
  settings: { thresholdDays: number; demoDate: string };
};

function isState(value: unknown): value is LegacyState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<LegacyState>;
  return (
    Array.isArray(state.products) &&
    Array.isArray(state.recommendations) &&
    Array.isArray(state.tasks) &&
    Array.isArray(state.activity) &&
    (state.invoiceIntakes === undefined || Array.isArray(state.invoiceIntakes)) &&
    Boolean(
      state.settings &&
      typeof state.settings.thresholdDays === "number" &&
      typeof state.settings.demoDate === "string",
    )
  );
}

function normalizeState(state: LegacyState): LegacyState {
  return { ...state, invoiceIntakes: state.invoiceIntakes ?? [] };
}

function database(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Set it to the Supabase-hosted PostgreSQL database where the imported state belongs.",
    );
  }
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

async function insertIfMissing(pool: Pool, businessId: string, rawState: unknown): Promise<boolean> {
  if (!BUSINESS_WORKSPACES.some((business) => business.id === businessId)) {
    throw new Error(`Refusing to import an unknown business ID: ${businessId}`);
  }
  if (!isState(rawState)) {
    throw new Error(`Legacy state for ${businessId} has an invalid structure.`);
  }
  const result = await pool.query(
    `INSERT INTO freshflow_business_state (business_id, state)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (business_id) DO NOTHING
     RETURNING business_id`,
    [businessId, JSON.stringify(normalizeState(rawState))],
  );
  return result.rowCount === 1;
}

async function importLocal(pool: Pool): Promise<void> {
  let found = false;
  for (const business of BUSINESS_WORKSPACES) {
    const file = path.join(process.cwd(), ".data", `${business.id}.json`);
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    found = true;
    let state: unknown;
    try {
      state = JSON.parse(content);
    } catch {
      throw new Error(`Could not parse the existing local state for ${business.id}.`);
    }
    const inserted = await insertIfMissing(pool, business.id, state);
    console.info(`${inserted ? "Imported" : "Kept existing"} local state for ${business.id}.`);
  }
  if (!found) console.info("No legacy local state files were found; nothing was imported.");
}

async function main() {
  const source = process.argv[2];
  if (source !== "local") {
    throw new Error("The legacy Supabase REST import was removed. FreshFlow now uses the Supabase PostgreSQL database directly; choose local, or use npm run db:migrate:supabase to copy rows between PostgreSQL databases.");
  }
  const pool = database();
  try {
    if (source === "local") await importLocal(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "State import failed.";
  console.error(message);
  process.exitCode = 1;
});

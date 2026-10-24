import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUSINESS_WORKSPACES, DEFAULT_BUSINESS_ID } from "../src/lib/businesses";
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
    throw new Error("DATABASE_URL is required. Use the Replit-managed PostgreSQL database.");
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

function legacySupabaseConfig(): { url: string; key: string } {
  const urlValue = process.env.LEGACY_SUPABASE_URL?.trim();
  const key = process.env.LEGACY_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!urlValue || !key) {
    throw new Error("Set LEGACY_SUPABASE_URL and LEGACY_SUPABASE_SERVICE_ROLE_KEY temporarily to import Supabase data.");
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("LEGACY_SUPABASE_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("LEGACY_SUPABASE_URL must use HTTPS.");
  }
  return { url: url.toString().replace(/\/$/, ""), key };
}

async function readLegacySupabaseTable(
  url: string,
  key: string,
  table: string,
  query: Record<string, string>,
): Promise<unknown[] | null> {
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(query)) endpoint.searchParams.set(name, value);
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Legacy Supabase read failed for ${table} (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error(`Legacy Supabase returned invalid rows for ${table}.`);
  return body;
}

async function importSupabase(pool: Pool): Promise<void> {
  const { url, key } = legacySupabaseConfig();
  const currentRows = await readLegacySupabaseTable(
    url,
    key,
    "freshflow_business_state",
    { select: "business_id,state" },
  );
  let imported = 0;
  if (currentRows) {
    for (const row of currentRows) {
      if (!row || typeof row !== "object") continue;
      const source = row as { business_id?: unknown; state?: unknown };
      if (typeof source.business_id !== "string") continue;
      const inserted = await insertIfMissing(pool, source.business_id, source.state);
      console.info(`${inserted ? "Imported" : "Kept existing"} legacy Supabase state for ${source.business_id}.`);
      if (inserted) imported += 1;
    }
  }

  const legacyRows = await readLegacySupabaseTable(url, key, "freshflow_state", {
    id: "eq.demo",
    select: "state",
  });
  if (legacyRows?.length) {
    const row = legacyRows[0];
    const state = row && typeof row === "object" ? (row as { state?: unknown }).state : undefined;
    const inserted = await insertIfMissing(pool, DEFAULT_BUSINESS_ID, state);
    console.info(`${inserted ? "Imported" : "Kept existing"} legacy Supabase demo state for ${DEFAULT_BUSINESS_ID}.`);
    if (inserted) imported += 1;
  }
  if (!currentRows && !legacyRows?.length) {
    console.info("No recognized legacy Supabase state rows were found.");
  } else {
    console.info(`${imported} state row${imported === 1 ? "" : "s"} imported; existing destination rows were never overwritten.`);
  }
}

async function main() {
  const source = process.argv[2];
  if (source !== "local" && source !== "supabase") {
    throw new Error("Choose an import source: local or supabase.");
  }
  const pool = database();
  try {
    if (source === "local") await importLocal(pool);
    else await importSupabase(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "State import failed.";
  console.error(message);
  process.exitCode = 1;
});

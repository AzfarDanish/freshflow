import { Pool } from "pg";

/**
 * One-time, non-destructive copy of FreshFlow's PostgreSQL rows into the
 * Supabase-hosted PostgreSQL project. This is a migration-only tool: it is not
 * used by the app at runtime and it never overwrites destination data.
 *
 * Environment (migration-only, never exposed to the client):
 * - SOURCE_DATABASE_URL (defaults to DATABASE_URL): the database holding the rows to copy.
 * - SUPABASE_DATABASE_URL (falls back to DATABASE_URL): the Supabase PostgreSQL target.
 *
 * Tables are copied in the same statement shape that `src/lib/db/schema.ts`
 * models, so `npm run db:push` against Supabase expects no further changes.
 */

type TableSpec = {
  name: string;
  columns: readonly string[];
  keys: readonly string[];
};

const TABLES: ReadonlyArray<TableSpec> = [
  { name: "freshflow_business_state", columns: ["business_id", "state", "updated_at"], keys: ["business_id"] },
  {
    name: "freshflow_invoice_documents",
    columns: ["id", "business_id", "file_name", "mime_type", "sha256", "file_size_bytes", "contents", "created_at"],
    keys: ["id"],
  },
  {
    name: "freshflow_memberships",
    columns: ["user_id", "business_id", "role", "active", "granted_by", "updated_at"],
    keys: ["user_id", "business_id"],
  },
  { name: "freshflow_state_backups", columns: ["id", "business_id", "state", "digest", "created_at"], keys: ["id"] },
];

const JSON_COLUMNS = new Set(["state"]);
const BATCH_SIZE = 50;

export function resolveConnectionUrls(env: Record<string, string | undefined>): { source: string; target: string } {
  const source = env.SOURCE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || "";
  const target = env.SUPABASE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || "";
  if (!source) {
    throw new Error(
      "Set SOURCE_DATABASE_URL (or DATABASE_URL) to the database holding the rows to copy.",
    );
  }
  if (!target) {
    throw new Error(
      "Set SUPABASE_DATABASE_URL (or, after the switch, leave it open so DATABASE_URL is used) for the Supabase PostgreSQL connection.",
    );
  }
  if (source === target) {
    throw new Error("Source and target connection strings are identical; refusing to copy a database into itself.");
  }
  return { source, target };
}

function quoteIdent(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Refusing to quote unsafe identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function buildBatchInsert(
  table: TableSpec,
  rows: ReadonlyArray<Record<string, unknown>>,
): { sql: string; values: unknown[] } {
  const columnList = table.columns.map(quoteIdent).join(", ");
  const keyList = table.keys.map(quoteIdent).join(", ");
  const paramWidth = table.columns.length;
  const placeholders: string[] = [];
  const values: unknown[] = [];
  rows.forEach((row, rowIndex) => {
    const start = rowIndex * paramWidth;
    placeholders.push(
      `(${table.columns.map((_, columnIndex) => `$${start + columnIndex + 1}`).join(", ")})`,
    );
    for (const column of table.columns) {
      values.push(JSON_COLUMNS.has(column) ? JSON.stringify(row[column] ?? null) : row[column] ?? null);
    }
  });
  // Insert-only copy: existing destination rows win and are never modified.
  const sql = `insert into ${quoteIdent(table.name)} (${columnList}) values ${placeholders.join(", ")} on conflict (${keyList}) do nothing`;
  return { sql, values };
}

export function chunkRows<T>(rows: ReadonlyArray<T>, size: number): Array<Array<T>> {
  if (size < 1) throw new Error("Batch size must be positive.");
  const batches: Array<Array<T>> = [];
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size));
  return batches;
}

function database(url: string, label: string): Pool {
  try {
    return new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15_000 });
  } catch {
    throw new Error(`Could not prepare the ${label} connection. Verify the connection string format.`);
  }
}

async function copyTable(pool: Pool, sourcePool: Pool, table: TableSpec): Promise<string> {
  const columnList = table.columns.map(quoteIdent).join(", ");
  const keyList = table.keys.map(quoteIdent).join(", ");
  const result = await sourcePool.query<Record<string, unknown>>(
    `select ${columnList} from ${quoteIdent(table.name)} order by ${keyList}`,
  );
  const rows = result.rows;
  if (!rows.length) return `${table.name}: 0 rows in the source database; nothing to copy.`;

  let inserted = 0;
  for (const batch of chunkRows(rows, BATCH_SIZE)) {
    const { sql, values } = buildBatchInsert(table, batch);
    const response = await pool.query(sql, values);
    inserted += response.rowCount ?? 0;
  }
  const kept = rows.length - inserted;
  return `${table.name}: ${inserted} row${inserted === 1 ? "" : "s"} copied, ${kept} existing row${kept === 1 ? "" : "s"} kept.`;
}

async function main(): Promise<void> {
  const { source, target } = resolveConnectionUrls(process.env);
  const sourcePool = database(source, "source");
  const targetPool = database(target, "Supabase");
  try {
    for (const table of TABLES) {
      process.stdout.write(`${await copyTable(targetPool, sourcePool, table)}\n`);
    }
    process.stdout.write(
      "Copy complete. Existing Supabase rows were never overwritten; rerun any time for newer rows.\n",
    );
    process.stdout.write(
      "For a fully consistent move, rerun during a quiet window with the app idle so the last writes are captured.\n",
    );
  } finally {
    await Promise.allSettled([sourcePool.end(), targetPool.end()]);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Supabase migration failed.";
  console.error(message);
  process.exitCode = 1;
});

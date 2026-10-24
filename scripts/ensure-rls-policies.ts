import { Pool } from "pg";
import { existsSync } from "node:fs";

// Load .env.local if present and DATABASE_URL is not set
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  try {
    // Node.js 20.6.0+ built-in env file loader
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore if not supported
  }
}

/**
 * Idempotently ensures all FreshFlow tables have proper Row-Level Security (RLS)
 * permissive policies for the least-privilege `freshflow_app` role with
 * explicit `USING (true) WITH CHECK (true)`.
 *
 * This fixes the issue where `drizzle-kit push` strips `using` and `withCheck`,
 * leaving `qual: null, with_check: null` (which PostgreSQL defaults to denying all rows).
 */
export async function ensureRlsPolicies(connectionString?: string): Promise<{ updated: string[]; verified: string[] }> {
  const url = connectionString !== undefined ? connectionString : process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to ensure RLS policies.");
  }

  const pool = new Pool({ connectionString: url });
  const updated: string[] = [];
  const verified: string[] = [];

  try {
    // 1. Get all freshflow tables
    const tablesRes = await pool.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'freshflow_%'
      ORDER BY tablename;
    `);

    for (const row of tablesRes.rows) {
      const table = row.tablename;
      const policyName = `freshflow_app_all_${table}`;

      // Check existing policy
      const polRes = await pool.query<{
        polname: string;
        qual: string | null;
        with_check: string | null;
      }>(`
        SELECT polname,
               pg_get_expr(polqual, polrelid) AS qual,
               pg_get_expr(polwithcheck, polrelid) AS with_check
        FROM pg_policy
        WHERE polrelid = $1::regclass AND polname = $2;
      `, [table, policyName]);

      if (polRes.rows.length === 0) {
        // Create policy
        await pool.query(`
          CREATE POLICY "${policyName}" ON "${table}"
          AS PERMISSIVE FOR ALL
          TO "freshflow_app"
          USING (true)
          WITH CHECK (true);
        `);
        updated.push(table);
      } else {
        const pol = polRes.rows[0];
        if (pol.qual !== "true" || pol.with_check !== "true") {
          await pool.query(`
            ALTER POLICY "${policyName}" ON "${table}"
            USING (true)
            WITH CHECK (true);
          `);
          updated.push(table);
        } else {
          verified.push(table);
        }
      }

      // Ensure RLS is enabled on the table
      await pool.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    }

    return { updated, verified };
  } finally {
    await pool.end();
  }
}

// When run directly from CLI
if (require.main === module || (typeof process !== "undefined" && process.argv[1]?.endsWith("ensure-rls-policies.ts"))) {
  ensureRlsPolicies()
    .then(({ updated, verified }) => {
      console.log(`RLS policies verified: ${verified.length} tables OK, ${updated.length} tables updated.`);
      if (updated.length > 0) {
        console.log(`Updated tables: ${updated.join(", ")}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to ensure RLS policies:", err);
      process.exit(1);
    });
}

import { describe, expect, it } from "vitest";
import {
  buildBatchInsert,
  chunkRows,
  resolveConnectionUrls,
} from "../scripts/migrate-postgres-to-supabase";
import { ensureRlsPolicies } from "../scripts/ensure-rls-policies";

describe("supabase migration tooling", () => {
  it("requires DATABASE_URL when ensuring RLS policies", async () => {
    await expect(ensureRlsPolicies("")).rejects.toThrow(/DATABASE_URL/);
  });
  it("resolves migration-only connection URLs and refuses identical endpoints", () => {
    expect(() => resolveConnectionUrls({})).toThrow(/SOURCE_DATABASE_URL/);
    expect(() => resolveConnectionUrls({ SOURCE_DATABASE_URL: "postgresql://src" }))
      .toThrow(/SUPABASE_DATABASE_URL/);
    const urls = resolveConnectionUrls({ DATABASE_URL: "postgresql://src", SUPABASE_DATABASE_URL: "postgresql://target" });
    expect(urls).toEqual({ source: "postgresql://src", target: "postgresql://target" });
    // After the switch, the Supabase target falls back to DATABASE_URL.
    expect(resolveConnectionUrls({
      SOURCE_DATABASE_URL: "postgresql://previous",
      DATABASE_URL: "postgresql://supabase",
    })).toEqual({ source: "postgresql://previous", target: "postgresql://supabase" });
    expect(() => resolveConnectionUrls({
      SOURCE_DATABASE_URL: "postgresql://same",
      SUPABASE_DATABASE_URL: "postgresql://same",
    })).toThrow(/identical/);
    expect(() => resolveConnectionUrls({ DATABASE_URL: "postgresql://same" })).toThrow(/identical/);
    expect(resolveConnectionUrls({
      SOURCE_DATABASE_URL: "postgresql://explicit",
      DATABASE_URL: "postgresql://fallback",
      SUPABASE_DATABASE_URL: "postgresql://target",
    }).source).toBe("postgresql://explicit");
  });

  it("builds insert-only SQL that never overwrites destination rows", () => {
    const table = {
      name: "freshflow_memberships",
      columns: ["user_id", "business_id", "role", "active"],
      keys: ["user_id", "business_id"],
    } as const;
    const { sql, values } = buildBatchInsert(table, [
      { user_id: "u1", business_id: "b1", role: "owner", active: true },
    ]);
    expect(sql).toBe(
      'insert into "freshflow_memberships" ("user_id", "business_id", "role", "active") values ($1, $2, $3, $4) on conflict ("user_id", "business_id") do nothing',
    );
    expect(values).toEqual(["u1", "b1", "owner", true]);
    expect(sql.includes("delete") || sql.includes("update")).toBe(false);
  });

  it("serializes jsonb state columns and pads placeholders across batches", () => {
    const table = {
      name: "freshflow_business_state",
      columns: ["business_id", "state"],
      keys: ["business_id"],
    } as const;
    const { sql, values } = buildBatchInsert(table, [
      { business_id: "b1", state: { products: [] } },
      { business_id: "b2", state: null },
    ]);
    expect(sql).toBe(
      'insert into "freshflow_business_state" ("business_id", "state") values ($1, $2), ($3, $4) on conflict ("business_id") do nothing',
    );
    expect(values[0]).toBe("b1");
    expect(values[1]).toBe('{"products":[]}');
    expect(values[3]).toBe("null");
  });

  it("chunks rows into positive-size batches", () => {
    expect(chunkRows([], 3)).toEqual([]);
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunkRows([1], 0)).toThrow(/positive/);
  });
});

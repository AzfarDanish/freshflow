import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "./fixtures/seed-state";
import type { AppState } from "../src/lib/types";

const database = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(), connect: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db", () => ({
  getPool: () => ({ connect: database.connect }),
}));

beforeEach(() => {
  delete process.env.FRESHFLOW_LOCAL_STATE_PATH;
  database.query.mockReset();
  database.release.mockReset();
  database.connect.mockResolvedValue({ query: database.query, release: database.release });
});
afterEach(() => vi.restoreAllMocks());

describe("PostgreSQL operational transactions", () => {
  it("reads existing state without issuing seed inserts or state updates", async () => {
    const { currentBusinessDate } = await import("../src/lib/expiry");
    const state = createSeedState();
    state.settings.demoDate = currentBusinessDate();
    state.recommendations = [];
    state.activity = [];
    database.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT state") ? [{ state: structuredClone(state) }] : [],
    }));
    const { getCurrentState } = await import("../src/lib/store");
    expect((await getCurrentState()).state).toEqual(state);
    const queries = database.query.mock.calls.map(([sql]) => sql as string);
    expect(queries.some((sql) => /INSERT|UPDATE freshflow_business_state/.test(sql))).toBe(false);
    expect(queries.at(-1)).toBe("COMMIT");
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("commits changed records and their activity together in the workspace-scoped row", async () => {
    let state: AppState = createSeedState();
    database.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("SELECT state")) return { rows: [{ state: structuredClone(state) }] };
      if (sql.includes("UPDATE freshflow_business_state")) state = JSON.parse(values![0] as string) as AppState;
      return { rows: [] };
    });
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const updated = await dispatchAction({ type: "set_threshold", payload: { thresholdDays: 3 } });
    expect(updated.state.settings.thresholdDays).toBe(3);
    expect(updated.state.activity.at(-1)!.type).toBe("settings_changed");
    expect((await getCurrentState()).state).toEqual(updated.state);
    const update = database.query.mock.calls.find(([sql]) => (sql as string).includes("UPDATE freshflow_business_state"))!;
    expect(update[1][1]).toBe("freshflow-demo");
    expect(update[0]).toContain("WHERE business_id = $2");
    expect(database.query.mock.calls.map(([sql]) => sql)).toContain("COMMIT");
  });

  it("rolls back invalid operations without issuing a state update", async () => {
    database.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT state") ? [{ state: createSeedState() }] : [],
    }));
    const { dispatchAction } = await import("../src/lib/store");
    await expect(dispatchAction({
      type: "complete_task", payload: { taskId: "missing", outcomeType: "rotated", role: "staff" },
    })).rejects.toThrow("Task not found");
    expect(database.query.mock.calls.map(([sql]) => sql).at(-1)).toBe("ROLLBACK");
    expect(database.query.mock.calls.some(([sql]) => (sql as string).includes("UPDATE freshflow_business_state"))).toBe(false);
    expect(database.release).toHaveBeenCalledOnce();
  });

  it("does not overwrite invalid stored state with the seed dataset", async () => {
    database.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("SELECT state") ? [{ state: { damaged: true } }] : [],
    }));
    const { getCurrentState } = await import("../src/lib/store");
    await expect(getCurrentState()).rejects.toThrow("invalid FreshFlow state");
    expect(database.query.mock.calls.some(([sql]) => /INSERT|UPDATE freshflow_business_state/.test(sql as string))).toBe(false);
    expect(database.query.mock.calls.map(([sql]) => sql).at(-1)).toBe("ROLLBACK");
  });
});

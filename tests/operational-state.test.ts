import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSeedState } from "./fixtures/seed-state";
import type { AppState, InventoryAction } from "../src/lib/types";

vi.mock("server-only", () => ({}));
let directory = "";
let statePath = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "freshflow-operations-"));
  statePath = path.join(directory, "state.json");
  process.env.FRESHFLOW_LOCAL_STATE_PATH = statePath;
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  await writeFile(statePath,JSON.stringify(createSeedState()));
});
afterEach(async () => {
  delete process.env.FRESHFLOW_LOCAL_STATE_PATH;
  await rm(directory, { recursive: true, force: true });
});

const reset: InventoryAction = { type: "reset", payload: { confirmed: true } };
const milkEdit = (overrides = {}) => ({
  type: "edit_inventory" as const,
  payload: {
    productId: "product-milk", originalBatchId: "MILK-001", batchId: "MILK-001",
    productName: "Fresh milk", sku: "MILK", category: "Dairy", unit: "bottles",
    quantity: 8, expiryDate: "2026-10-25", ...overrides,
  },
});

describe("stored operational state", () => {
  it("reads the exact stored dataset without regenerating records or activity", async () => {
    const state = createSeedState();
    state.products[0]!.batches[0]!.quantity = 17;
    state.recommendations = [];
    state.tasks = [];
    state.activity = [];
    await writeFile(statePath, JSON.stringify(state));
    const before = await readFile(statePath, "utf8");
    const { getCurrentState } = await import("../src/lib/store");
    for (let index = 0; index < 3; index++) {
      expect((await getCurrentState()).state).toEqual(state);
    }
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  it("persists edits and updates rule facts from stored values, not fixed scenarios", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    await getCurrentState();
    const updated = await dispatchAction(milkEdit({ quantity: 19, expiryDate: "2026-10-26" }));
    const risk = updated.state.recommendations.find((item) => item.batchId === "MILK-001")!;
    expect(risk).toMatchObject({ quantity: 19, expiryDate: "2026-10-26", daysUntilExpiry: 2 });
    expect(risk.explanation).toContain("19 bottles");
    expect(risk.explanation).toContain("2 days");
    expect((await getCurrentState()).state).toEqual(updated.state);
    const bytes = await readFile(statePath, "utf8");
    await expect(dispatchAction(milkEdit({ quantity: -1 }))).rejects.toThrow("Quantity");
    expect(await readFile(statePath, "utf8")).toBe(bytes);
  });

  it("keeps decisions, work and audit links consistent when a batch is renamed", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const starting = await getCurrentState();
    const risk = starting.state.recommendations.find((item) => item.batchId === "MILK-001")!;
    const approved = await dispatchAction({
      type: "approve", payload: { recommendationId: risk.id, assignedTo: "Aina", role: "owner" },
    });
    const renamed = await dispatchAction(milkEdit({ batchId: "MILK-RENAMED" }));
    expect(renamed.state.tasks).toHaveLength(1);
    expect(renamed.state.tasks[0]).toMatchObject({ batchId: "MILK-RENAMED", status: "open" });
    expect(renamed.state.tasks[0]!.title).toContain("MILK-RENAMED");
    expect(renamed.state.recommendations.filter((item) => item.productId === "product-milk")).toHaveLength(1);
    expect(renamed.state.recommendations.find((item) => item.id === risk.id)).toMatchObject({ status: "approved" });
    // Historical events are not rewritten to pretend the old label never existed.
    expect(renamed.state.activity.find((item) => item.type === "approved")!.description).toContain("MILK-001");
    const complete = await dispatchAction({
      type: "complete_task", payload: { taskId: approved.state.tasks[0]!.id, outcomeType: "reported_to_owner", role: "staff" },
    });
    expect(complete.state.tasks[0]).toMatchObject({ status: "completed", outcome: "Reported to owner" });
    expect(complete.state.products[0]!.batches[0]!.quantity).toBe(8);
    await expect(dispatchAction({
      type: "complete_task", payload: { taskId: approved.state.tasks[0]!.id, outcomeType: "rotated", role: "staff" },
    })).rejects.toThrow("already complete");
    expect((await getCurrentState()).state.activity.filter((item) => item.type === "task_completed")).toHaveLength(1);
  });

  it("serializes competing decisions and never creates duplicate staff tasks", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = await getCurrentState();
    const action: InventoryAction = {
      type: "approve", payload: { recommendationId: initial.state.recommendations[0]!.id, assignedTo: "Ravi", role: "owner" },
    };
    const results = await Promise.allSettled([dispatchAction(action), dispatchAction(action)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stored = await getCurrentState();
    expect(stored.state.tasks).toHaveLength(1);
    expect(stored.state.activity.filter((item) => item.type === "approved")).toHaveLength(1);
  });

  it("does not invent settings or inventory activity for no-op saves", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    await getCurrentState();
    const before = await readFile(statePath, "utf8");
    await expect(dispatchAction(milkEdit())).rejects.toThrow("No inventory changes");
    await expect(dispatchAction({ type: "set_threshold", payload: { thresholdDays: 7 } })).rejects.toThrow("already set");
    await expect(dispatchAction({ type: "set_threshold", payload: { thresholdDays: 0 } })).rejects.toThrow("1 to 14");
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  it("refuses restoration after decisions, task completion and settings changes, leaving all records intact", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = (await getCurrentState()).state;
    const milkRisk = initial.recommendations.find((item) => item.batchId === "MILK-001")!;
    const breadRisk = initial.recommendations.find((item) => item.batchId === "BREAD-004")!;
    const approved = await dispatchAction({
      type: "approve", payload: { recommendationId: milkRisk.id, assignedTo: "Mei Ling", role: "owner" },
    });
    await dispatchAction({ type: "reject", payload: { recommendationId: breadRisk.id, reason: "Handled separately", role: "owner" } });
    await dispatchAction({ type: "complete_task", payload: { taskId: approved.state.tasks[0]!.id, outcomeType: "rotated", role: "staff" } });
    await dispatchAction(milkEdit({ quantity: 21 }));
    await dispatchAction({ type: "set_threshold", payload: { thresholdDays: 14 } });
    const unrelatedPath = path.join(directory, "unrelated-workspace.json");
    await writeFile(unrelatedPath, '{"keep":"untouched"}');
    const beforeReset=(await getCurrentState()).state;
    await expect(dispatchAction(reset)).rejects.toThrow("disabled");
    expect((await getCurrentState()).state).toEqual(beforeReset);
    expect(beforeReset.tasks).toHaveLength(1);
    expect(beforeReset.settings.thresholdDays).toBe(14);
    expect(await readFile(unrelatedPath, "utf8")).toBe('{"keep":"untouched"}');
  });

  it("rejects unconfirmed reset at both the API and store boundary", async () => {
    const { getCurrentState, dispatchAction } = await import("../src/lib/store");
    await getCurrentState();
    const before = await readFile(statePath, "utf8");
    await expect(dispatchAction({ type: "reset" } as InventoryAction)).rejects.toThrow("disabled");
    const { POST } = await import("../app/api/action/route");
    const response = await POST(new Request("http://freshflow.test/api/action", {
      method: "POST", body: JSON.stringify({ action: { type: "reset" } }),
    }));
    expect(response.status).not.toBe(200);
    expect((await response.json()).error).toBeTruthy();
    expect(await readFile(statePath, "utf8")).toBe(before);
  });
});

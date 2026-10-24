import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyRisk, createSeedState } from "../src/lib/expiry";

vi.mock("server-only", () => ({}));

let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "freshflow-test-"));
  process.env.FRESHFLOW_LOCAL_STATE_PATH = path.join(
    temporaryDirectory,
    "state.json",
  );
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(async () => {
  delete process.env.FRESHFLOW_LOCAL_STATE_PATH;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("expiry rules", () => {
  it("flags the demo milk batch within the configured threshold", () => {
    expect(classifyRisk("2026-10-25", "2026-10-24", 7)).toEqual({
      riskType: "approaching",
      daysUntilExpiry: 1,
    });
  });

  it("keeps expired stock separate from upcoming stock", () => {
    expect(classifyRisk("2026-10-23", "2026-10-24", 7)).toEqual({
      riskType: "expired",
      daysUntilExpiry: -1,
    });
    expect(classifyRisk("2026-10-24", "2026-10-24", 7)).toEqual({
      riskType: "approaching",
      daysUntilExpiry: 0,
    });
  });

  it("does not flag batches beyond the selected threshold", () => {
    expect(classifyRisk("2026-11-02", "2026-10-24", 7)).toBeNull();
  });
});

describe("inventory action state transitions", () => {
  it("approves a recommendation, assigns a task, and records completion without changing stock", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const starting = await getCurrentState();
    const milkRisk = starting.state.recommendations.find(
      (recommendation) => recommendation.batchId === "MILK-001",
    );
    expect(milkRisk).toBeDefined();
    const beforeQuantity = starting.state.products
      .flatMap((product) => product.batches)
      .find((batch) => batch.id === "MILK-001")?.quantity;

    const approved = await dispatchAction({
      type: "approve",
      payload: {
        recommendationId: milkRisk!.id,
        assignedTo: "Aina",
        role: "owner",
      },
    });
    const task = approved.state.tasks.find(
      (item) => item.recommendationId === milkRisk!.id,
    );
    expect(approved.state.recommendations.find((item) => item.id === milkRisk!.id)?.status).toBe("approved");
    expect(task?.assignedTo).toBe("Aina");
    expect(task?.status).toBe("open");

    const completed = await dispatchAction({
      type: "complete_task",
      payload: {
        taskId: task!.id,
        outcome: "Rotated bottles to the front shelf",
        role: "staff",
      },
    });
    expect(completed.state.tasks.find((item) => item.id === task!.id)?.outcome).toBe(
      "Rotated bottles to the front shelf",
    );
    const afterQuantity = completed.state.products
      .flatMap((product) => product.batches)
      .find((batch) => batch.id === "MILK-001")?.quantity;
    expect(afterQuantity).toBe(beforeQuantity);
    expect(completed.state.activity.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "risk_detected",
        "approved",
        "task_created",
        "task_assigned",
        "task_completed",
      ]),
    );
  });

  it("records a rejection without creating an assignable task", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = await getCurrentState();
    const risk = initial.state.recommendations.find(
      (recommendation) => recommendation.batchId === "MILK-001",
    )!;
    const result = await dispatchAction({
      type: "reject",
      payload: {
        recommendationId: risk.id,
        reason: "Owner will inspect first",
        role: "owner",
      },
    });
    expect(result.state.recommendations.find((item) => item.id === risk.id)?.status).toBe("rejected");
    expect(result.state.tasks).toHaveLength(0);
    expect(result.state.activity.at(-1)?.description).toContain("Owner will inspect first");
  });

  it("adds a batch, detects its risk, and restores the seed data on reset", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    await getCurrentState();
    const added = await dispatchAction({
      type: "add_inventory",
      payload: {
        productName: "Fresh milk",
        sku: "MILK",
        category: "Dairy",
        unit: "bottles",
        batchId: "MILK-003",
        quantity: 12,
        expiryDate: "2026-10-24",
      },
    });
    expect(
      added.state.recommendations.find((item) => item.batchId === "MILK-003")
        ?.riskType,
    ).toBe("approaching");
    const reset = await dispatchAction({ type: "reset" });
    expect(reset.state.products.flatMap((product) => product.batches)).toHaveLength(
      createSeedState().products.flatMap((product) => product.batches).length,
    );
    expect(reset.state.tasks).toHaveLength(0);
    expect(reset.state.recommendations.some((item) => item.batchId === "MILK-003")).toBe(false);
    expect(reset.state.activity.at(-1)?.type).toBe("demo_reset");
  });

  it("rejects duplicate decisions", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = await getCurrentState();
    const risk = initial.state.recommendations.find(
      (recommendation) => recommendation.batchId === "MILK-001",
    )!;
    await dispatchAction({
      type: "reject",
      payload: { recommendationId: risk.id, role: "owner" },
    });
    await expect(
      dispatchAction({
        type: "approve",
        payload: { recommendationId: risk.id, assignedTo: "Aina", role: "owner" },
      }),
    ).rejects.toThrow("already been decided");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyRisk, createSeedState } from "../src/lib/expiry";
import type { AppState } from "../src/lib/types";

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
  vi.unstubAllGlobals();
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

  it("edits a batch and recalculates its pending expiry risk", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = await getCurrentState();
    const product = initial.state.products.find((item) => item.sku === "MILK")!;
    const batch = product.batches.find((item) => item.id === "MILK-001")!;

    const updated = await dispatchAction({
      type: "edit_inventory",
      payload: {
        productId: product.id,
        originalBatchId: batch.id,
        batchId: "MILK-010",
        productName: "Fresh milk",
        sku: "MILK",
        category: "Dairy",
        unit: "bottles",
        quantity: 7,
        expiryDate: "2026-12-25",
      },
    });
    expect(updated.state.products[0]?.batches.some((item) => item.id === "MILK-010")).toBe(true);
    expect(updated.state.recommendations.some((item) => item.batchId === "MILK-001" && item.status === "pending")).toBe(false);
    expect(updated.state.recommendations.some((item) => item.batchId === "MILK-010" && item.status === "pending")).toBe(false);

    const riskyAgain = await dispatchAction({
      type: "edit_inventory",
      payload: {
        productId: product.id,
        originalBatchId: "MILK-010",
        batchId: "MILK-010",
        productName: "Fresh milk",
        sku: "MILK",
        category: "Dairy",
        unit: "bottles",
        quantity: 7,
        expiryDate: "2026-10-25",
      },
    });
    expect(
      riskyAgain.state.recommendations.find(
        (item) => item.batchId === "MILK-010" && item.status === "pending",
      )?.quantity,
    ).toBe(7);
    expect(riskyAgain.state.activity.filter((event) => event.type === "inventory_edited")).toHaveLength(2);
    expect(riskyAgain.state.activity.some((event) => event.batchId === "MILK-010" && event.type === "risk_detected")).toBe(true);
  });

  it("keeps each demo shop in separate local storage and resets only the selected shop", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const primary = await getCurrentState();
    const second = await getCurrentState("kedai-runcit-demo");
    expect(second.state.products).toHaveLength(0);

    await dispatchAction(
      {
        type: "add_inventory",
        payload: {
          productName: "Demo apples",
          sku: "APPLE",
          category: "Produce",
          unit: "crates",
          batchId: "APPLE-001",
          quantity: 3,
          expiryDate: "2026-11-01",
        },
      },
      "kedai-runcit-demo",
    );
    expect((await getCurrentState("kedai-runcit-demo")).state.products).toHaveLength(1);
    expect((await getCurrentState()).state.products).toHaveLength(primary.state.products.length);

    await dispatchAction({ type: "reset" }, "kedai-runcit-demo");
    expect((await getCurrentState("kedai-runcit-demo")).state.products).toHaveLength(0);
    expect((await getCurrentState()).state.products).toHaveLength(primary.state.products.length);
  });

  it("does not overwrite existing local shop data during initialization", async () => {
    const existing = createSeedState();
    existing.products[0]!.batches[0]!.quantity = 31;
    await writeFile(process.env.FRESHFLOW_LOCAL_STATE_PATH!, JSON.stringify(existing));

    const { getCurrentState } = await import("../src/lib/store");
    const loaded = await getCurrentState();
    expect(
      loaded.state.products[0]?.batches.find((item) => item.id === "MILK-001")?.quantity,
    ).toBe(31);
    const persisted = JSON.parse(
      await readFile(process.env.FRESHFLOW_LOCAL_STATE_PATH!, "utf8"),
    ) as AppState;
    expect(
      persisted.products[0]?.batches.find((item) => item.id === "MILK-001")?.quantity,
    ).toBe(31);
  });

  it("does not reset a shop containing non-synthetic records", async () => {
    const existing = createSeedState();
    (existing.products[0] as unknown as { simulated: boolean }).simulated = false;
    await writeFile(process.env.FRESHFLOW_LOCAL_STATE_PATH!, JSON.stringify(existing));

    const { dispatchAction } = await import("../src/lib/store");
    await expect(dispatchAction({ type: "reset" })).rejects.toThrow(
      "cannot be reset as a demo",
    );
    const persisted = JSON.parse(
      await readFile(process.env.FRESHFLOW_LOCAL_STATE_PATH!, "utf8"),
    ) as { products: Array<{ simulated: boolean }> };
    expect(persisted.products[0]?.simulated).toBe(false);
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

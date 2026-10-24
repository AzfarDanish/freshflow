import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROLE_PERMISSIONS } from "../src/lib/access-control";
import type { InventoryAction } from "../src/lib/types";
import {
  PREVIEW_ROLE_COOKIE,
  signPreviewRoleCookie,
  verifyPreviewRoleCookie,
} from "../src/lib/role-session";

vi.mock("server-only", () => ({}));

let directory = "";
let statePath = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "freshflow-role-tests-"));
  statePath = path.join(directory, "state.json");
  process.env.FRESHFLOW_LOCAL_STATE_PATH = statePath;
});
afterEach(async () => {
  delete process.env.FRESHFLOW_LOCAL_STATE_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe("Owner and Staff permission matrix", () => {
  it("matches each page and mutation permission in the requirements", () => {
    expect(ROLE_PERMISSIONS.owner.pages).toEqual([
      "overview", "decisions", "tasks", "activity", "invoices", "inventory", "settings",
    ]);
    expect(ROLE_PERMISSIONS.staff.pages).toEqual([
      "overview", "tasks", "activity", "inventory",
    ]);
    expect(ROLE_PERMISSIONS.staff.actions).toEqual(["complete_task"]);
    for (const action of ROLE_PERMISSIONS.staff.actions) {
      expect(ROLE_PERMISSIONS.owner.actions).toContain(action);
    }
  });

  it("signs role previews and treats a modified cookie as the restricted role", () => {
    const cookie = signPreviewRoleCookie("owner");
    expect(verifyPreviewRoleCookie(cookie)).toBe("owner");
    expect(verifyPreviewRoleCookie(signPreviewRoleCookie("staff"))).toBe("staff");
    expect(verifyPreviewRoleCookie(`${cookie.slice(0, -2)}00`)).toBe("staff");
    expect(verifyPreviewRoleCookie(undefined)).toBe("owner");
  });

  it("prevents a Staff API request from spoofing Owner in the submitted action", async () => {
    const { getCurrentState } = await import("../src/lib/store");
    await getCurrentState();
    const before = await readFile(statePath, "utf8");
    const { POST } = await import("../app/api/action/route");
    const response = await POST(new Request("http://freshflow.test/api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${PREVIEW_ROLE_COOKIE}=${signPreviewRoleCookie("staff")}`,
      },
      body: JSON.stringify({
        action: {
          type: "add_inventory",
          payload: {
            productName: "New stock", sku: "NEW", category: "Food", unit: "bags",
            batchId: "NEW-1", quantity: 5, expiryDate: "2027-01-01", role: "owner",
          },
        },
      }),
    }));
    expect(response.status).toBe(403);
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  it("limits Staff state responses and rejects invoice uploads and downloads", async () => {
    const { getCurrentState } = await import("../src/lib/store");
    const ownerState = await getCurrentState();
    const cookie = `${PREVIEW_ROLE_COOKIE}=${signPreviewRoleCookie("staff")}`;
    const { GET: getState } = await import("../app/api/state/route");
    const response = await getState(new Request("http://freshflow.test/api/state", {
      headers: { cookie },
    }));
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state.role).toBe("staff");
    expect(state.state.recommendations).toEqual([]);
    expect(state.state.invoiceIntakes).toEqual([]);
    expect(state.state.products).toEqual(ownerState.state.products);
    expect(state.recommendationCount).toBe(ownerState.state.recommendations.length);

    const { POST: upload } = await import("../app/api/invoices/route");
    expect((await upload(new Request("http://freshflow.test/api/invoices", {
      method: "POST", headers: { cookie }, body: "not parsed before permission check",
    }))).status).toBe(403);
    const { GET: download } = await import("../app/api/invoices/[intakeId]/file/route");
    expect((await download(
      new Request("http://freshflow.test/api/invoices/sensitive/file", { headers: { cookie } }),
      { params: Promise.resolve({ intakeId: "sensitive" }) },
    )).status).toBe(403);
  });

  it("lets both roles complete a task and records the actual selected preview role", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = (await getCurrentState()).state;
    const recommendationId = initial.recommendations[0]!.id;
    const approved = await dispatchAction({
      type: "approve",
      payload: { recommendationId, assignedTo: "Aina", role: "staff" },
    }, "freshflow-demo", "owner");
    const taskId = approved.state.tasks[0]!.id;
    const { POST } = await import("../app/api/action/route");
    const ownerCookie = `${PREVIEW_ROLE_COOKIE}=${signPreviewRoleCookie("owner")}`;
    const response = await POST(new Request("http://freshflow.test/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({
        action: { type: "complete_task", payload: { taskId, outcomeType: "rotated", role: "staff" } },
      }),
    }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.state.tasks[0].status).toBe("completed");
    expect(saved.state.activity.at(-1).actor).toBe("simulated_owner");

  });

  it("allows Owners to delete a batch only after confirmation and blocks Staff", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const initial = (await getCurrentState()).state;
    const milkBatch = initial.products.find((item) => item.id === "product-milk")!.batches
      .find((item) => item.id === "MILK-001")!;
    const deletion: InventoryAction = {
      type: "delete_inventory",
      payload: { productId: "product-milk", batchId: milkBatch.id, confirmed: true },
    };
    await expect(dispatchAction(deletion, "freshflow-demo", "staff")).rejects.toMatchObject({ status: 403 });
    const deleted = await dispatchAction(deletion, "freshflow-demo", "owner");
    expect(deleted.state.products.find((item) => item.id === "product-milk")!.batches)
      .not.toContainEqual(milkBatch);
    expect(deleted.state.recommendations.some((item) => item.batchId === milkBatch.id)).toBe(false);
    expect(deleted.state.activity.at(-1)).toMatchObject({ type: "inventory_deleted", batchId: milkBatch.id });
    const added = await dispatchAction({
      type: "add_inventory",
      payload: {
        productName: "Fresh milk", sku: "MILK", category: "Dairy", unit: "bottles",
        batchId: "MILK-002", quantity: 3, expiryDate: "2026-10-25",
      },
    }, "freshflow-demo", "owner");
    const newRisk = added.state.recommendations.find((item) => item.batchId === "MILK-002")!;
    await dispatchAction({
      type: "approve",
      payload: { recommendationId: newRisk.id, assignedTo: "Aina", role: "owner" },
    }, "freshflow-demo", "owner");
    await expect(dispatchAction({
      type: "delete_inventory",
      payload: { productId: "product-milk", batchId: "MILK-002", confirmed: true },
    }, "freshflow-demo", "owner")).rejects.toThrow("open staff task");
  });

  it("sets an HttpOnly signed cookie when the preview role is switched", async () => {
    const { POST } = await import("../app/api/role/route");
    const response = await POST(new Request("http://freshflow.test/api/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "staff" }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie).toContain(signPreviewRoleCookie("staff"));
  });
});

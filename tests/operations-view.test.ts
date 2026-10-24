import { describe, expect, it } from "vitest";
import { createSeedState } from "../src/lib/expiry";
import {
  batchRisk,
  expiryGroups,
  filterInventory,
  inventoryRows,
  sortTasks,
  workspaceHasOnlySyntheticRecords,
} from "../src/lib/operations-view";
import type { Product, StaffTask } from "../src/lib/types";

const products: Product[] = [
  {
    id: "p-milk", name: "Fresh milk", sku: "MILK", category: "Dairy", unit: "bottles", simulated: true,
    batches: [
      { id: "MILK-001", productId: "p-milk", quantity: 8, expiryDate: "2026-10-25", addedAt: "", simulated: true },
      { id: "MILK-OLD", productId: "p-milk", quantity: 2, expiryDate: "2026-10-20", addedAt: "", simulated: true },
    ],
  },
  {
    id: "p-rice", name: "Rice", sku: "RICE", category: "Pantry", unit: "bags", simulated: true,
    batches: [{ id: "RICE-1", productId: "p-rice", quantity: 5, expiryDate: "2027-03-01", addedAt: "", simulated: true }],
  },
];

describe("operations view helpers", () => {
  it("classifies batches against the reference date without overlap", () => {
    expect(batchRisk("2026-10-24", "2026-10-20", 3)).toMatchObject({ group: "expired", tone: "danger", days: -4 });
    expect(batchRisk("2026-10-24", "2026-10-24", 3)).toMatchObject({ group: "approaching", label: "Expires today" });
    expect(batchRisk("2026-10-24", "2026-10-27", 3)).toMatchObject({ group: "approaching", label: "3d left" });
    expect(batchRisk("2026-10-24", "2026-10-28", 3)).toMatchObject({ group: "safe", tone: "neutral" });
  });

  it("groups expired and approaching batches separately, ordered by expiry", () => {
    const groups = expiryGroups(products, "2026-10-24", 3);
    expect(groups.expired.map((row) => row.batch.id)).toEqual(["MILK-OLD"]);
    expect(groups.approaching.map((row) => row.batch.id)).toEqual(["MILK-001"]);
  });

  it("filters inventory by status and free-text search", () => {
    const rows = inventoryRows(products);
    expect(filterInventory(rows, "", "all", "2026-10-24", 3)).toHaveLength(3);
    expect(filterInventory(rows, "", "safe", "2026-10-24", 3).map((row) => row.batch.id)).toEqual(["RICE-1"]);
    expect(filterInventory(rows, "dairy", "all", "2026-10-24", 3)).toHaveLength(2);
    expect(filterInventory(rows, "  milk-001 ", "approaching", "2026-10-24", 3)).toHaveLength(1);
    expect(filterInventory(rows, "milk", "safe", "2026-10-24", 3)).toHaveLength(0);
  });

  it("lists open staff tasks before completed ones", () => {
    const base = { recommendationId: "r", title: "t", instruction: "i", assignedTo: "Aina", simulated: true } as const;
    const tasks: StaffTask[] = [
      { ...base, id: "done", status: "completed", createdAt: "2026-10-24T03:00:00Z" },
      { ...base, id: "open-old", status: "open", createdAt: "2026-10-24T01:00:00Z" },
      { ...base, id: "open-new", status: "open", createdAt: "2026-10-24T02:00:00Z" },
    ];
    expect(sortTasks(tasks).map((task) => task.id)).toEqual(["open-new", "open-old", "done"]);
  });

  it("mirrors the server reset safeguard for non-sample records", () => {
    const state = createSeedState();
    expect(workspaceHasOnlySyntheticRecords(state)).toBe(true);
    state.invoiceIntakes.push({
      id: "invoice-x", fileName: "a.csv", mimeType: "text/csv", fileSizeBytes: 1, sha256: "x",
      uploadedAt: "2026-10-24T00:00:00Z", status: "review", warnings: [], proposals: [], simulated: false,
    });
    expect(workspaceHasOnlySyntheticRecords(state)).toBe(false);
  });
});

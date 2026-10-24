import { describe, expect, it } from "vitest";
import { OPERATIONS, operationForPath } from "../src/lib/operation-navigation";
import { BUSINESS_WORKSPACES, DEFAULT_BUSINESS_ID } from "../src/lib/businesses";

describe("operation routing", () => {
  it("gives every operation a unique, dedicated URL without anchors", () => {
    expect(OPERATIONS.map((operation) => operation.id)).toEqual([
      "overview", "decisions", "tasks", "activity", "invoices", "inventory", "insights", "settings",
    ]);
    expect(new Set(OPERATIONS.map((operation) => operation.href)).size).toBe(8);
    for (const operation of OPERATIONS) {
      expect(operation.href).not.toContain("#");
      expect(operationForPath(operation.href)?.id).toBe(operation.id);
      expect(operationForPath(`${operation.href}/`)?.id).toBe(operation.id);
    }
  });

  it("does not treat an unknown route as Overview", () => {
    expect(operationForPath("/missing")).toBeUndefined();
    expect(operationForPath("/inventory/missing")).toBeUndefined();
  });

  it("retains FreshFlow as the sole available workspace", () => {
    expect(BUSINESS_WORKSPACES).toEqual([
      { id: DEFAULT_BUSINESS_ID, name: "Workspace", simulated: false },
    ]);
  });
});

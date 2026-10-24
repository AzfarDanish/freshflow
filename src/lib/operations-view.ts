import type {
  ActivityEvent,
  AppState,
  InventoryBatch,
  Product,
  Recommendation,
  StaffTask,
} from "@/src/lib/types";

/**
 * Pure presentation helpers for the operations interface. They do not change
 * expiry rules; they only group and label state already returned by the API.
 */

export type InventoryFilter = "all" | "expired" | "approaching" | "safe";
export type RiskTone = "danger" | "warning" | "neutral";
export type InventoryRow = { product: Product; batch: InventoryBatch };

export function dateLabel(value?: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("en-MY", { day: "numeric", month: "short" })} · ${date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) /
      86400000,
  );
}

export function batchRisk(
  referenceDate: string,
  expiryDate: string,
  thresholdDays: number,
): { days: number; tone: RiskTone; label: string; group: Exclude<InventoryFilter, "all"> } {
  const days = daysBetween(referenceDate, expiryDate);
  if (days < 0) {
    return { days, tone: "danger", label: `Expired ${Math.abs(days)}d ago`, group: "expired" };
  }
  if (days <= thresholdDays) {
    return {
      days,
      tone: "warning",
      label: days === 0 ? "Expires today" : `${days}d left`,
      group: "approaching",
    };
  }
  return { days, tone: "neutral", label: "No current risk", group: "safe" };
}

export function inventoryRows(products: Product[]): InventoryRow[] {
  return products.flatMap((product) => product.batches.map((batch) => ({ product, batch })));
}

export function expiryGroups(
  products: Product[],
  referenceDate: string,
  thresholdDays: number,
): { expired: InventoryRow[]; approaching: InventoryRow[] } {
  const expired: InventoryRow[] = [];
  const approaching: InventoryRow[] = [];
  for (const row of inventoryRows(products)) {
    if(row.batch.quantity<=0||!row.batch.expiryDate)continue;
    const { group } = batchRisk(referenceDate, row.batch.expiryDate, thresholdDays);
    if (group === "expired") expired.push(row);
    else if (group === "approaching") approaching.push(row);
  }
  const byExpiry = (a: InventoryRow, b: InventoryRow) =>
    a.batch.expiryDate.localeCompare(b.batch.expiryDate);
  return { expired: expired.sort(byExpiry), approaching: approaching.sort(byExpiry) };
}

export function filterInventory(
  rows: InventoryRow[],
  query: string,
  filter: InventoryFilter,
  referenceDate: string,
  thresholdDays: number,
): InventoryRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(({ product, batch }) => {
    const { group } = batchRisk(referenceDate, batch.expiryDate, thresholdDays);
    if (filter !== "all" && group !== filter) return false;
    if (!needle) return true;
    return [product.name, product.sku, product.category, product.unit, batch.id, batch.expiryDate]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function sortRecommendations(recommendations: Recommendation[]): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    const pendingOrder = Number(b.status === "pending") - Number(a.status === "pending");
    if (pendingOrder) return pendingOrder;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function sortTasks(tasks: StaffTask[]): StaffTask[] {
  return [...tasks].sort((a, b) => {
    const openOrder = Number(b.status === "open") - Number(a.status === "open");
    if (openOrder) return openOrder;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function taskInventorySummary(task: StaffTask, recommendation?: Recommendation): string {
  const productName = task.productName ?? recommendation?.productName;
  const sku = task.sku ?? recommendation?.sku;
  const batchId = task.batchId ?? recommendation?.batchId;
  const quantity = task.quantity ?? recommendation?.quantity;
  const unit = task.unit ?? recommendation?.unit;
  const expiryDate = task.expiryDate ?? recommendation?.expiryDate;
  return [
    productName,
    sku,
    batchId ? `Batch ${batchId}` : undefined,
    quantity !== undefined ? `${quantity} ${unit ?? ""}`.trim() : undefined,
    expiryDate ? `Expires ${dateLabel(expiryDate)}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function activityActorLabel(actor: ActivityEvent["actor"]): string {
  if(actor==="owner")return "Owner";
  if(actor==="staff")return "Staff";
  if (actor === "simulated_owner") return "Owner (simulated role)";
  if (actor === "simulated_staff") return "Staff (simulated role)";
  return "System";
}

/**
 * Mirrors the server's reset safeguard so the interface can explain in advance
 * why reset is unavailable. The server remains the authority and re-checks.
 */
export function workspaceHasOnlySyntheticRecords(state: AppState): boolean {
  return (
    state.products.every(
      (product) => product.simulated === true && product.batches.every((batch) => batch.simulated === true),
    ) &&
    state.recommendations.every((recommendation) => recommendation.simulated === true) &&
    state.tasks.every((task) => task.simulated === true) &&
    state.activity.every((event) => event.simulated === true) &&
    state.invoiceIntakes.every((intake) => intake.simulated === true)
  );
}

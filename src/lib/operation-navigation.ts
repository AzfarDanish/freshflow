export const OPERATIONS = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "decisions", href: "/decisions", label: "Decisions" },
  { id: "tasks", href: "/tasks", label: "Staff tasks" },
  { id: "activity", href: "/activity", label: "Activity" },
  { id: "invoices", href: "/invoices", label: "Invoice intake" },
  { id: "inventory", href: "/inventory", label: "Inventory" },
  { id: "insights", href: "/insights", label: "Waste Insights" },
  { id: "settings", href: "/settings", label: "Settings & data" },
] as const;

export type OperationId = typeof OPERATIONS[number]["id"];

export function operationForPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return OPERATIONS.find((operation) => operation.href === path);
}

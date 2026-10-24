import type { AppState, InventoryAction, Role, StateResponse } from "@/src/lib/types";
import type { OperationId } from "@/src/lib/operation-navigation";

export const ROLE_PERMISSIONS = {
  owner: {
    pages: ["overview", "decisions", "tasks", "activity", "invoices", "inventory", "settings"],
    actions: [
      "add_inventory", "edit_inventory", "edit_invoice_proposal",
      "delete_inventory",
      "confirm_invoice_proposal", "discard_invoice_proposal",
      "set_threshold", "approve", "reject", "complete_task", "reset",
      "upload_invoice", "view_invoice_file",
    ],
  },
  staff: {
    pages: ["overview", "tasks", "activity", "inventory"],
    actions: ["complete_task"],
  },
} as const satisfies Record<Role, { pages: readonly OperationId[]; actions: readonly string[] }>;

export function canAccessOperation(role: Role, operation: OperationId): boolean {
  return (ROLE_PERMISSIONS[role].pages as readonly OperationId[]).includes(operation);
}

export type ActionPermission =
  | InventoryAction["type"]
  | "upload_invoice"
  | "view_invoice_file";

export function canPerformAction(role: Role, action: ActionPermission): boolean {
  return (ROLE_PERMISSIONS[role].actions as readonly string[]).includes(action);
}

export class AccessDeniedError extends Error {
  readonly status = 403;

  constructor(role: Role, operation: string) {
    super(`${role === "owner" ? "Owner" : "Staff"} preview role is not allowed to ${operation}.`);
    this.name = "AccessDeniedError";
  }
}

export function requireActionPermission(role: Role, action: ActionPermission): void {
  if (!canPerformAction(role, action)) {
    throw new AccessDeniedError(role, action.replaceAll("_", " "));
  }
}

export function filterStateForRole(response: StateResponse, role: Role): StateResponse {
  const { state } = response;
  const pendingRecommendationCount = state.recommendations.filter(
    (item) => item.status === "pending",
  ).length;
  const recommendationCount = state.recommendations.length;
  const projectedState: AppState = role === "owner"
    ? state
    : { ...state, recommendations: [], invoiceIntakes: [] };
  return {
    ...response,
    state: projectedState,
    role,
    recommendationCount,
    pendingRecommendationCount,
  };
}

export function roleBoundAction(action: InventoryAction, role: Role): InventoryAction {
  switch (action.type) {
    case "complete_task":
      return { ...action, payload: { ...action.payload, role } };
    case "approve":
      return { ...action, payload: { ...action.payload, role } };
    case "reject":
      return { ...action, payload: { ...action.payload, role } };
    case "edit_invoice_proposal":
      return { ...action, payload: { ...action.payload, role } };
    case "confirm_invoice_proposal":
      return { ...action, payload: { ...action.payload, role } };
    case "discard_invoice_proposal":
      return { ...action, payload: { ...action.payload, role } };
    default:
      return action;
  }
}

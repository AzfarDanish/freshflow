import { NextResponse } from "next/server";
import {
  DEFAULT_BUSINESS_ID,
  getBusinessWorkspace,
} from "@/src/lib/businesses";
import { dispatchAction } from "@/src/lib/store";
import {
  TASK_OUTCOME_TYPES,
  type InvoiceProposalInput,
  type InventoryAction,
  type TaskOutcomeType,
} from "@/src/lib/types";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(
  value: unknown,
  label: string,
  maxLength = 120,
): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized || undefined;
}

function editableText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function invoiceFields(value: unknown): InvoiceProposalInput {
  if (!isRecord(value)) throw new Error("Invoice proposal fields are required.");
  const quantity = value.quantity;
  if (
    quantity !== null &&
    quantity !== undefined &&
    (typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 100_000)
  ) {
    throw new Error("Quantity must be a positive number from 0 to 100,000.");
  }
  return {
    productName: editableText(value.productName, "Product name", 160),
    sku: editableText(value.sku, "SKU", 60),
    category: editableText(value.category, "Category", 60),
    quantity: typeof quantity === "number" ? quantity : null,
    unit: editableText(value.unit, "Unit", 40),
    batchId: editableText(value.batchId, "Batch ID", 80),
    expiryDate: editableText(value.expiryDate, "Expiry date", 30),
    matchedProductId: optionalText(value.matchedProductId, "Matched product", 100),
  };
}

function demoRole(
  value: unknown,
  defaultRole: "owner" | "staff",
): "owner" | "staff" {
  if (value === undefined) return defaultRole;
  if (value === "owner" || value === "staff") return value;
  throw new Error("Choose the Owner or Staff role view.");
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseAction(input: unknown): InventoryAction {
  if (!isRecord(input) || typeof input.type !== "string") {
    throw new Error("Send a valid FreshFlow action.");
  }
  if (input.type === "reset") {
    if (!isRecord(input.payload) || input.payload.confirmed !== true) {
      throw new Error("Confirm the whole-demo reset before continuing.");
    }
    return { type: "reset", payload: { confirmed: true } };
  }
  if (!isRecord(input.payload)) throw new Error("Action details are required.");
  const payload = input.payload;

  switch (input.type) {
    case "add_inventory": {
      const quantity = payload.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100_000
      ) {
        throw new Error("Quantity must be a whole number from 1 to 100,000.");
      }
      if (!isValidDate(payload.expiryDate)) {
        throw new Error("Enter a valid expiry date.");
      }
      return {
        type: "add_inventory",
        payload: {
          productName: text(payload.productName, "Product name"),
          sku: text(payload.sku, "SKU", 40),
          category: text(payload.category, "Category", 60),
          unit: text(payload.unit, "Unit", 30),
          batchId: text(payload.batchId, "Batch ID", 60),
          quantity,
          expiryDate: payload.expiryDate,
        },
      };
    }
    case "edit_inventory": {
      const quantity = payload.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > 100_000
      ) {
        throw new Error("Quantity must be positive and no greater than 100,000.");
      }
      if (!isValidDate(payload.expiryDate)) {
        throw new Error("Enter a valid expiry date.");
      }
      return {
        type: "edit_inventory",
        payload: {
          productId: text(payload.productId, "Product", 100),
          originalBatchId: text(payload.originalBatchId, "Original batch ID", 60),
          batchId: text(payload.batchId, "Batch ID", 60),
          productName: text(payload.productName, "Product name"),
          sku: text(payload.sku, "SKU", 40),
          category: text(payload.category, "Category", 60),
          unit: text(payload.unit, "Unit", 30),
          quantity,
          expiryDate: payload.expiryDate,
        },
      };
    }
    case "edit_invoice_proposal":
      return {
        type: "edit_invoice_proposal",
        payload: {
          intakeId: text(payload.intakeId, "Invoice", 100),
          proposalId: text(payload.proposalId, "Invoice line", 100),
          fields: invoiceFields(payload.fields),
          role: demoRole(payload.role, "owner"),
        },
      };
    case "confirm_invoice_proposal": {
      const matchMode = payload.matchMode;
      if (matchMode !== "existing" && matchMode !== "new") {
        throw new Error("Choose an existing product or create a new product.");
      }
      return {
        type: "confirm_invoice_proposal",
        payload: {
          intakeId: text(payload.intakeId, "Invoice", 100),
          proposalId: text(payload.proposalId, "Invoice line", 100),
          fields: invoiceFields(payload.fields),
          matchMode,
          role: demoRole(payload.role, "owner"),
        },
      };
    }
    case "discard_invoice_proposal":
      return {
        type: "discard_invoice_proposal",
        payload: {
          intakeId: text(payload.intakeId, "Invoice", 100),
          proposalId: text(payload.proposalId, "Invoice line", 100),
          role: demoRole(payload.role, "owner"),
        },
      };
    case "set_threshold": {
      const thresholdDays = payload.thresholdDays;
      if (
        typeof thresholdDays !== "number" ||
        !Number.isInteger(thresholdDays) ||
        thresholdDays < 1 ||
        thresholdDays > 14
      ) {
        throw new Error("Expiry threshold must be a whole number from 1 to 14 days.");
      }
      return { type: "set_threshold", payload: { thresholdDays } };
    }
    case "approve":
      return {
        type: "approve",
        payload: {
          recommendationId: text(payload.recommendationId, "Recommendation", 100),
          assignedTo: text(payload.assignedTo, "Assignee", 60),
          role: demoRole(payload.role, "owner"),
        },
      };
    case "reject":
      return {
        type: "reject",
        payload: {
          recommendationId: text(payload.recommendationId, "Recommendation", 100),
          reason: optionalText(payload.reason, "Rejection reason", 250),
          role: demoRole(payload.role, "owner"),
        },
      };
    case "complete_task": {
      const outcomeType = payload.outcomeType;
      if (
        typeof outcomeType !== "string" ||
        !TASK_OUTCOME_TYPES.includes(outcomeType as TaskOutcomeType)
      ) {
        throw new Error("Choose a valid staff-reported outcome.");
      }
      const outcomeExplanation = optionalText(
        payload.outcomeExplanation,
        "Outcome explanation",
        500,
      );
      if (
        outcomeType === "other" &&
        (!outcomeExplanation || outcomeExplanation.length < 3)
      ) {
        throw new Error("Explain the Other outcome in at least 3 characters.");
      }
      return {
        type: "complete_task",
        payload: {
          taskId: text(payload.taskId, "Task", 100),
          outcomeType: outcomeType as TaskOutcomeType,
          outcomeExplanation,
          role: demoRole(payload.role, "staff"),
        },
      };
    }
    default:
      throw new Error("That action is not supported.");
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    const actionEnvelope =
      isRecord(body) && "action" in body ? body.action : body;
    const businessId =
      isRecord(body) && typeof body.businessId === "string"
        ? body.businessId
        : DEFAULT_BUSINESS_ID;
    if (!getBusinessWorkspace(businessId)) {
      return NextResponse.json(
        { error: "That demo shop is not available." },
        { status: 400 },
      );
    }
    const action = parseAction(actionEnvelope);
    return NextResponse.json(await dispatchAction(action, businessId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "That action could not be saved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

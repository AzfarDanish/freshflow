import { NextResponse } from "next/server";
import {
  DEFAULT_BUSINESS_ID,
  getBusinessWorkspace,
} from "@/src/lib/businesses";
import { dispatchAction } from "@/src/lib/store";
import {
  TASK_OUTCOME_TYPES,
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

function demoRole(
  value: unknown,
  defaultRole: "owner" | "staff",
): "owner" | "staff" {
  if (value === undefined) return defaultRole;
  if (value === "owner" || value === "staff") return value;
  throw new Error("Choose Owner or Staff demo role.");
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
  if (input.type === "reset") return { type: "reset" };
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

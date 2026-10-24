import { NextResponse } from "next/server";
import { dispatchAction } from "@/src/lib/store";
import type { InventoryAction } from "@/src/lib/types";

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
          role: payload.role === "staff" ? "staff" : "owner",
        },
      };
    case "reject":
      if (payload.reason !== undefined && typeof payload.reason !== "string") {
        throw new Error("Rejection reason must be text.");
      }
      return {
        type: "reject",
        payload: {
          recommendationId: text(payload.recommendationId, "Recommendation", 100),
          reason:
            typeof payload.reason === "string"
              ? payload.reason.trim().slice(0, 250)
              : undefined,
          role: payload.role === "staff" ? "staff" : "owner",
        },
      };
    case "complete_task":
      return {
        type: "complete_task",
        payload: {
          taskId: text(payload.taskId, "Task", 100),
          outcome: text(payload.outcome, "Staff-reported outcome", 500),
          role: payload.role === "owner" ? "owner" : "staff",
        },
      };
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
    const action = parseAction(body);
    return NextResponse.json(await dispatchAction(action), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "That action could not be saved.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

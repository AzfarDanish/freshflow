import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createSeedState, reconcileRisks } from "@/src/lib/expiry";
import type {
  ActivityEvent,
  AppState,
  InventoryAction,
  PersistenceMode,
  Product,
  Recommendation,
  StaffTask,
} from "@/src/lib/types";

const SUPABASE_TABLE = "freshflow_state";
const STATE_ROW_ID = "demo";

let operationQueue: Promise<unknown> = Promise.resolve();

function localStatePath(): string {
  const configuredPath = process.env.FRESHFLOW_LOCAL_STATE_PATH?.trim();
  return configuredPath
    ? path.resolve(configuredPath)
    : path.join(process.cwd(), ".data", "freshflow-demo.json");
}

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function persistenceMode(): PersistenceMode {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (Boolean(url) !== Boolean(serviceKey)) {
    throw new Error(
      "Supabase is only enabled when both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured.",
    );
  }
  return url && serviceKey ? "supabase" : "local_demo";
}

function supabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase configuration is incomplete.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("SUPABASE_URL must use HTTPS.");
  }
  return { url: parsed.toString().replace(/\/$/, ""), key };
}

async function supabaseRequest(
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  const { url, key } = supabaseConfig();
  return fetch(`${url}/rest/v1/${endpoint}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function readSupabaseState(): Promise<AppState | null> {
  const response = await supabaseRequest(
    `${SUPABASE_TABLE}?id=eq.${STATE_ROW_ID}&select=state`,
  );
  if (!response.ok) {
    throw new Error(
      `Supabase read failed (${response.status}). Check the database table and server environment variables.`,
    );
  }
  const rows = (await response.json()) as Array<{ state: AppState }>;
  if (!Array.isArray(rows)) {
    throw new Error("Supabase returned an invalid state response.");
  }
  if (rows.length === 0) return null;
  if (!isAppState(rows[0]?.state)) {
    throw new Error("Supabase contains an invalid FreshFlow state row.");
  }
  return rows[0].state;
}

async function writeSupabaseState(state: AppState): Promise<void> {
  const response = await supabaseRequest(`${SUPABASE_TABLE}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ id: STATE_ROW_ID, state }]),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase write failed (${response.status}). Check table access and database setup.`,
    );
  }
}

async function readLocalState(): Promise<AppState | null> {
  try {
    const contents = await readFile(localStatePath(), "utf8");
    const parsed = JSON.parse(contents) as AppState;
    if (!isAppState(parsed)) {
      throw new Error("The local demo state has an invalid structure.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AppState>;
  return (
    Array.isArray(state.products) &&
    Array.isArray(state.recommendations) &&
    Array.isArray(state.tasks) &&
    Array.isArray(state.activity) &&
    Boolean(state.settings && typeof state.settings.thresholdDays === "number")
  );
}

async function writeLocalState(state: AppState): Promise<void> {
  const statePath = localStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}

async function loadState(): Promise<{
  state: AppState;
  mode: PersistenceMode;
  existed: boolean;
}> {
  const mode = persistenceMode();
  const stored =
    mode === "supabase" ? await readSupabaseState() : await readLocalState();
  return { state: stored ?? createSeedState(), mode, existed: stored !== null };
}

async function saveState(
  state: AppState,
  mode: PersistenceMode,
): Promise<void> {
  if (mode === "supabase") return writeSupabaseState(state);
  return writeLocalState(state);
}

export async function getCurrentState(): Promise<{
  state: AppState;
  persistenceMode: PersistenceMode;
}> {
  return exclusive(async () => {
    const loaded = await loadState();
    const changed = reconcileRisks(loaded.state);
    if (!loaded.existed || changed) {
      await saveState(loaded.state, loaded.mode);
    }
    return { state: loaded.state, persistenceMode: loaded.mode };
  });
}

export async function dispatchAction(
  action: InventoryAction,
): Promise<{ state: AppState; persistenceMode: PersistenceMode }> {
  return exclusive(async () => {
    const loaded = await loadState();
    const now = new Date().toISOString();
    const state = loaded.state;
    if (!loaded.existed) reconcileRisks(state);

    switch (action.type) {
      case "add_inventory":
        addInventory(state, action.payload, now);
        break;
      case "set_threshold":
        state.settings.thresholdDays = action.payload.thresholdDays;
        addActivity(state, {
          type: "settings_changed",
          title: "Expiry threshold updated",
          description: `Upcoming expiry detection now includes batches within ${action.payload.thresholdDays} days.`,
          occurredAt: now,
        });
        reconcileRisks(state, now);
        break;
      case "approve":
        approveRecommendation(state, action.payload, now);
        break;
      case "reject":
        rejectRecommendation(state, action.payload, now);
        break;
      case "complete_task":
        completeTask(state, action.payload, now);
        break;
      case "reset": {
        const resetState = createSeedState();
        addActivity(resetState, {
          type: "demo_reset",
          title: "Demo reset",
          description: "The synthetic inventory and workflow were restored to their starting state.",
          occurredAt: now,
        });
        await saveState(resetState, loaded.mode);
        return { state: resetState, persistenceMode: loaded.mode };
      }
      default:
        assertNever(action);
    }
    reconcileRisks(state, now);
    await saveState(state, loaded.mode);
    return { state, persistenceMode: loaded.mode };
  });
}

function addInventory(
  state: AppState,
  input: Extract<InventoryAction, { type: "add_inventory" }>["payload"],
  now: string,
): void {
  const productName = input.productName.trim();
  const sku = input.sku.trim().toUpperCase();
  const category = input.category.trim();
  const unit = input.unit.trim();
  const batchId = input.batchId.trim().toUpperCase();
  let product = state.products.find(
    (existing) => existing.sku.toUpperCase() === sku,
  );
  if (!product) {
    product = {
      id: `product-${randomUUID()}`,
      name: productName,
      sku,
      category,
      unit,
      batches: [],
      simulated: true,
    };
    state.products.push(product);
  } else if (product.unit.toLowerCase() !== unit.toLowerCase()) {
    throw new Error("Use the existing unit for this product SKU.");
  }

  if (
    state.products.some((existing) =>
      existing.batches.some((batch) => batch.id === batchId),
    )
  ) {
    throw new Error("That batch ID is already in use.");
  }

  product.batches.push({
    id: batchId,
    productId: product.id,
    quantity: input.quantity,
    expiryDate: input.expiryDate,
    addedAt: now,
    simulated: true,
  });
  addActivity(state, {
    type: "inventory_added",
    title: "Inventory batch added",
    description: `${product.name} · batch ${batchId} · ${input.quantity} ${product.unit} · expires ${input.expiryDate}. This entry is simulated demo data.`,
    occurredAt: now,
  });
}

function approveRecommendation(
  state: AppState,
  input: Extract<InventoryAction, { type: "approve" }>["payload"],
  now: string,
): void {
  const recommendation = requirePendingRecommendation(
    state,
    input.recommendationId,
  );
  const assignedTo = input.assignedTo.trim();
  if (!assignedTo) throw new Error("Choose a staff member for the task.");
  recommendation.status = "approved";
  recommendation.decisionAt = now;
  recommendation.decisionBy = "Simulated owner";
  addActivity(state, {
    type: "approved",
    title: "Recommendation approved",
    description: `${recommendation.productName} · batch ${recommendation.batchId} was approved by the simulated owner.`,
    occurredAt: now,
  });
  const task: StaffTask = {
    id: `task-${randomUUID()}`,
    recommendationId: recommendation.id,
    title: `${recommendation.riskType === "expired" ? "Inspect" : "Rotate"} ${recommendation.productName} · ${recommendation.batchId}`,
    instruction: recommendation.suggestedAction,
    assignedTo,
    status: "open",
    createdAt: now,
    simulated: true,
  };
  state.tasks.push(task);
  addActivity(state, {
    type: "task_created",
    title: "Staff task created",
    description: `${task.title} was created after owner approval.`,
    occurredAt: now,
  });
  addActivity(state, {
    type: "task_assigned",
    title: "Task assigned",
    description: `${task.title} was assigned to ${assignedTo}.`,
    occurredAt: now,
  });
}

function rejectRecommendation(
  state: AppState,
  input: Extract<InventoryAction, { type: "reject" }>["payload"],
  now: string,
): void {
  const recommendation = requirePendingRecommendation(
    state,
    input.recommendationId,
  );
  recommendation.status = "rejected";
  recommendation.decisionAt = now;
  recommendation.decisionBy = "Simulated owner";
  const reason = input.reason?.trim();
  addActivity(state, {
    type: "rejected",
    title: "Recommendation rejected",
    description: `${recommendation.productName} · batch ${recommendation.batchId} was rejected by the simulated owner.${reason ? ` Reason: ${reason}` : ""}`,
    occurredAt: now,
  });
}

function completeTask(
  state: AppState,
  input: Extract<InventoryAction, { type: "complete_task" }>["payload"],
  now: string,
): void {
  const task = state.tasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status !== "open") throw new Error("This task is already complete.");
  const outcome = input.outcome.trim();
  if (!outcome) throw new Error("Enter the staff-reported outcome.");
  task.status = "completed";
  task.completedAt = now;
  task.outcome = outcome;
  addActivity(state, {
    type: "task_completed",
    title: "Staff task completed",
    description: `${task.title} was marked complete by the simulated staff role. Reported outcome: ${outcome}. Inventory quantities were not changed.`,
    occurredAt: now,
  });
}

function requirePendingRecommendation(
  state: AppState,
  recommendationId: string,
): Recommendation {
  const recommendation = state.recommendations.find(
    (item) => item.id === recommendationId,
  );
  if (!recommendation) throw new Error("Recommendation not found.");
  if (recommendation.status !== "pending") {
    throw new Error("This recommendation has already been decided.");
  }
  return recommendation;
}

function addActivity(
  state: AppState,
  input: Omit<ActivityEvent, "id" | "simulated">,
): void {
  state.activity.push({
    ...input,
    id: `event-${randomUUID()}`,
    simulated: true,
  });
}

function assertNever(value: never): never {
  throw new Error(`Unsupported action: ${JSON.stringify(value)}`);
}

import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BUSINESS_WORKSPACES,
  DEFAULT_BUSINESS_ID,
  requireBusinessWorkspace,
} from "@/src/lib/businesses";
import { getPool } from "@/src/lib/db";
import { requireActionPermission, roleBoundAction } from "@/src/lib/access-control";
import { createBusinessSeedState, currentBusinessDate, reconcileRisks } from "@/src/lib/expiry";
import type {
  ActivityEvent,
  AppState,
  InvoiceIntake,
  InvoiceProposal,
  InvoiceProposalInput,
  InventoryAction,
  PersistenceMode,
  Product,
  Recommendation,
  Role,
  StateResponse,
  StaffTask,
} from "@/src/lib/types";
import { appendMovement, batchIdHasHistory } from "@/src/lib/operations";
import {
  TASK_OUTCOME_LABELS, TASK_OUTCOME_TYPES, TASK_PROGRESS_LABELS, TASK_PROGRESS_TYPES,
} from "@/src/lib/types";

let operationQueue: Promise<unknown> = Promise.resolve();

function useTestLocalStorage(): boolean {
  return process.env.NODE_ENV === "test" && Boolean(process.env.FRESHFLOW_LOCAL_STATE_PATH);
}

function localStatePath(businessId: string): string {
  const configuredPath = process.env.FRESHFLOW_LOCAL_STATE_PATH?.trim();
  if (!configuredPath) {
    return path.join(process.cwd(), ".data", `${businessId}.json`);
  }
  const resolvedPath = path.resolve(configuredPath);
  if (businessId === DEFAULT_BUSINESS_ID) return resolvedPath;
  const extension = path.extname(resolvedPath) || ".json";
  const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
  return path.join(/*turbopackIgnore: true*/
    path.dirname(resolvedPath),
    `${baseName}.${businessId}${extension}`,
  );
}

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readLocalState(businessId: string): Promise<AppState | null> {
  try {
    const contents = await readFile(
      /*turbopackIgnore: true*/ localStatePath(businessId),
      "utf8",
    );
    const parsed = JSON.parse(contents) as unknown;
    if (!isAppState(parsed)) {
      throw new Error("The local demo state has an invalid structure.");
    }
    return normalizeAppState(parsed);
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
    Boolean(state.settings && typeof state.settings.thresholdDays === "number") &&
    (state.invoiceIntakes === undefined || Array.isArray(state.invoiceIntakes))
  );
}

function normalizeAppState(value: AppState): AppState {
  const today=currentBusinessDate(value.settings.timeZone);
  const state={ ...value, invoiceIntakes: value.invoiceIntakes ?? [], movements:value.movements??[], suppliers:value.suppliers??[], settings:{...value.settings, demoDate:today,timeZone:value.settings.timeZone??"Asia/Kuala_Lumpur",currency:value.settings.currency??"MYR"} };
  if(value.settings.demoDate!==today)reconcileRisks(state);
  return state;
}

async function writeLocalState(
  businessId: string,
  state: AppState,
): Promise<void> {
  const statePath = localStatePath(businessId);
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}

interface StateMutationResult<T> {
  state: AppState;
  value: T;
}

export async function withBusinessState<T>(
  businessId: string,
  operation: (
    state: AppState,
    client: PoolClient | null,
    mode: PersistenceMode,
  ) => Promise<StateMutationResult<T>>,
  readOnly = false,
): Promise<T> {
  const business = requireBusinessWorkspace(businessId);
  if (useTestLocalStorage()) {
    return exclusive(async () => {
      const stored = await readLocalState(business.id);
      const state = stored ?? createBusinessSeedState(business.id);
      const original=JSON.stringify(state);
      const updated = await operation(
        normalizeAppState(state),
        null,
        "test_local",
      );
      if (!readOnly || !stored || original!==JSON.stringify(updated.state)) await writeLocalState(business.id, updated.state);
      return updated.value;
    });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let result = await client.query<{ state: AppState }>(
      `SELECT state FROM freshflow_business_state
       WHERE business_id = $1
       FOR UPDATE`,
      [business.id],
    );
    if (!result.rows.length) {
      // Seed only a workspace that has never been initialized, never on reads
      // of an existing dataset. Concurrent first requests share the same row.
      await client.query(
        `INSERT INTO freshflow_business_state (business_id, state)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (business_id) DO NOTHING`,
        [business.id, JSON.stringify(createBusinessSeedState(business.id))],
      );
      result = await client.query<{ state: AppState }>(
        `SELECT state FROM freshflow_business_state
         WHERE business_id = $1
         FOR UPDATE`,
        [business.id],
      );
    }
    const stored = result.rows[0]?.state;
    if (!isAppState(stored)) {
      throw new Error("PostgreSQL contains an invalid FreshFlow state row.");
    }
    const original=JSON.stringify(stored);
    const updated = await operation(
      normalizeAppState(stored),
      client,
      "postgres",
    );
    if (!readOnly || original!==JSON.stringify(updated.state)) {
      await client.query(
        `UPDATE freshflow_business_state
         SET state = $1::jsonb, updated_at = now()
         WHERE business_id = $2`,
        [JSON.stringify(updated.state), business.id],
      );
    }
    await client.query("COMMIT");
    return updated.value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getCurrentState(
  businessId = DEFAULT_BUSINESS_ID,
): Promise<StateResponse> {
  return withBusinessState(businessId, async (state, _client, mode) => {
    const business = requireBusinessWorkspace(businessId);
    return {
      state,
      value: stateResponse(state, mode, business.id),
    };
  }, true);
}

export async function createInvoiceIntake(
  businessId: string,
  intake: InvoiceIntake,
  contents: Buffer,
  previewRole: Role = "owner",
): Promise<StateResponse> {
  requireActionPermission(previewRole, "upload_invoice");
  return withBusinessState(businessId, async (state, client, mode) => {
    if (state.invoiceIntakes.some((item) => item.id === intake.id)) {
      throw new Error("That invoice has already been uploaded.");
    }
    const repeated=state.invoiceIntakes.find(item=>item.uploadRequestId&&item.uploadRequestId===intake.uploadRequestId);
    if(repeated) {
      if(repeated.sha256!==intake.sha256)throw new Error("Upload request reference conflicts with a different document.");
      return {state,value:stateResponse(state,mode,businessId)};
    }
    if(state.invoiceIntakes.some(item=>item.sha256===intake.sha256))throw new Error("This document is already uploaded. Review the existing invoice instead.");
    for (const proposal of intake.proposals) {
      addProposalConflicts(state, intake, proposal);
    }
    if (client) {
      await client.query(
        `INSERT INTO freshflow_invoice_documents
          (id, business_id, file_name, mime_type, sha256, file_size_bytes, contents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          intake.id,
          businessId,
          intake.fileName,
          intake.mimeType,
          intake.sha256,
          intake.fileSizeBytes,
          contents,
        ],
      );
    } else {
      const testPath = localInvoicePath(businessId, intake.id);
      await mkdir(path.dirname(testPath), { recursive: true });
      await writeFile(testPath, contents, { mode: 0o600 });
    }
    state.invoiceIntakes.push(intake);
    addActivity(state, {
      type: "invoice_uploaded",
      title: "Supplier invoice uploaded",
      description: `${intake.proposals.length} invoice line${intake.proposals.length === 1 ? "" : "s"} extracted as unverified proposals. No inventory was created.`,
      occurredAt: intake.uploadedAt,
      invoiceId: intake.id,
      simulated: false,
    });
    return {
      state,
      value: stateResponse(state, mode, businessId),
    };
  });
}

function localInvoicePath(businessId: string, intakeId: string): string {
  if (!/^invoice-[a-f0-9-]{36}$/.test(intakeId)) {
    throw new Error("Invoice reference is invalid.");
  }
  return path.join(
    path.dirname(localStatePath(businessId)),
    `${businessId}.${intakeId}.invoice`,
  );
}

export async function getInvoiceDocument(
  businessId: string,
  intakeId: string,
  previewRole: Role = "owner",
): Promise<{ fileName: string; mimeType: string; sha256: string; contents: Buffer } | null> {
  requireActionPermission(previewRole, "view_invoice_file");
  requireBusinessWorkspace(businessId);
  if (!/^invoice-[a-f0-9-]{36}$/.test(intakeId)) {
    throw new Error("Invoice reference is invalid.");
  }
  if (useTestLocalStorage()) {
    const state = await readLocalState(businessId);
    const intake = state?.invoiceIntakes.find((item) => item.id === intakeId);
    if (!intake) return null;
    try {
      const contents = await readFile(localInvoicePath(businessId, intakeId));
      return {
        fileName: intake.fileName,
        mimeType: intake.mimeType,
        sha256: intake.sha256,
        contents,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  const result = await getPool().query<{
    file_name: string;
    mime_type: string;
    sha256: string;
    contents: Buffer;
  }>(
    `SELECT file_name, mime_type, sha256, contents
     FROM freshflow_invoice_documents
     WHERE business_id = $1 AND id = $2`,
    [businessId, intakeId],
  );
  const document = result.rows[0];
  return document
    ? {
        fileName: document.file_name,
        mimeType: document.mime_type,
        sha256: document.sha256,
        contents: document.contents,
      }
    : null;
}

export async function dispatchAction(
  action: InventoryAction,
  businessId = DEFAULT_BUSINESS_ID,
  previewRole?: Role,
  actorId?: string,
): Promise<StateResponse> {
  const payloadRole = action.payload && "role" in action.payload ? action.payload.role : undefined;
  const effectiveRole = previewRole ?? payloadRole ?? "owner";
  requireActionPermission(effectiveRole, action.type);
  action = roleBoundAction(action, effectiveRole);
  return withBusinessState(businessId, async (state, _client, mode) => {
    const business = requireBusinessWorkspace(businessId);
    const now = new Date().toISOString();
    const activityOffset = state.activity.length;
    const beforeInventory=structuredClone(state.products);
    let nextState = state;

    switch (action.type) {
      case "add_inventory":
        addInventory(state, action.payload, now);
        break;
      case "edit_inventory":
        editInventory(state, action.payload, now);
        break;
      case "delete_inventory":
        deleteInventory(state, action.payload, now);
        break;
      case "edit_invoice_proposal": {
        const invoice=state.invoiceIntakes.find(i=>i.id===action.payload.intakeId);
        const proposal=invoice?.proposals.find(p=>p.id===action.payload.proposalId);
        if(invoice?.status==="cancelled"||invoice?.processingStatus==="processing"||(proposal?.receivedQuantity??0)>0)throw new Error("Use invoice review corrections for processing, cancelled, or posted invoice lines.");
        const before=proposal?structuredClone(proposal):undefined;
        editInvoiceProposal(state, action.payload, now);
        if(invoice&&before){invoice.corrections??=[];invoice.corrections.push({at:now,actorId:actorId??effectiveRole,reason:"Owner edited an unposted invoice draft",before});}
        break;
      }
      case "confirm_invoice_proposal":
        throw new Error("Use explicit invoice receiving with physically received quantities and Owner confirmation.");
      case "discard_invoice_proposal": {
        const invoice=state.invoiceIntakes.find(i=>i.id===action.payload.intakeId);
        const proposal=invoice?.proposals.find(p=>p.id===action.payload.proposalId);
        if(invoice?.status==="cancelled"||invoice?.processingStatus==="processing"||(proposal?.receivedQuantity??0)>0)throw new Error("Reverse posted receipts before discarding a line; processing or cancelled invoices cannot be changed.");
        const before=proposal?structuredClone(proposal):undefined;
        discardInvoiceProposal(state, action.payload, now);
        if(invoice&&before){invoice.corrections??=[];invoice.corrections.push({at:now,actorId:actorId??effectiveRole,reason:"Owner discarded an unposted invoice line",before});}
        break;
      }
      case "set_threshold":
        if (!Number.isInteger(action.payload.thresholdDays) || action.payload.thresholdDays < 1 || action.payload.thresholdDays > 14) {
          throw new Error("Expiry threshold must be a whole number from 1 to 14 days.");
        }
        if (state.settings.thresholdDays === action.payload.thresholdDays) {
          throw new Error("The expiry threshold is already set to that value.");
        }
        state.settings.thresholdDays = action.payload.thresholdDays;
        addActivity(state, {
          type: "settings_changed",
          title: "Expiry threshold updated",
          description: `Upcoming expiry detection now includes batches within ${action.payload.thresholdDays} days.`,
          occurredAt: now,
        });
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
      case "update_task_progress":
        updateTaskProgress(state, action.payload, now);
        break;
      case "reset": {
        throw new Error("Demo restoration is disabled. Production records cannot be reset with this action.");
      }
      default:
        assertNever(action);
    }
    reconcileRisks(nextState, now);
    if(action.type==="add_inventory"||action.type==="edit_inventory"||action.type==="delete_inventory") {
      const oldProduct=action.type==="add_inventory"?undefined:beforeInventory.find(p=>p.id===action.payload.productId);
      const oldBatch=oldProduct?.batches.find(b=>b.id===(action.type==="edit_inventory"?action.payload.originalBatchId:action.type==="delete_inventory"?action.payload.batchId:""));
      const product=action.type==="add_inventory"?nextState.products.find(p=>p.batches.some(b=>b.id===action.payload.batchId)):nextState.products.find(p=>p.id===action.payload.productId);
      const batch=action.type==="delete_inventory"?undefined:product?.batches.find(b=>b.id===action.payload.batchId);
      const delta=(batch?.quantity??0)-(oldBatch?.quantity??0);
      const sourceProduct=product??oldProduct,sourceBatch=batch??oldBatch;
      if(delta&&sourceProduct&&sourceBatch)appendMovement(nextState,{requestId:randomUUID(),productId:sourceProduct.id,batchId:sourceBatch.id,productName:sourceProduct.name,sku:sourceProduct.sku,unit:sourceProduct.unit,kind:"adjustment",quantity:delta,occurredAt:now,actorId:actorId??effectiveRole,reason:action.type==="delete_inventory"?"Owner deleted an inventory batch":action.type==="add_inventory"?"Manual inventory addition":"Owner corrected inventory quantity"});
    }
    if(action.type==="approve"||action.type==="reject"){
      const recommendation=nextState.recommendations.find(r=>r.id===action.payload.recommendationId);
      if(recommendation)recommendation.decisionBy=actorId??effectiveRole;
    }
    for(const event of nextState.activity.slice(activityOffset)) {
      if(event.type!=="risk_detected") { event.actor=effectiveRole; event.actorId=actorId; }
      event.simulated=false;
      event.description=event.description.replaceAll("simulated owner","owner").replaceAll("simulated staff","staff");
    }
    return {
      state: nextState,
      value: stateResponse(nextState, mode, business.id, effectiveRole),
    };
  });
}

export function stateResponse(
  state: AppState,
  mode: PersistenceMode,
  businessId: string,
  role: Role = "owner",
): StateResponse {
  const business = requireBusinessWorkspace(businessId);
  return {
    state,
    persistenceMode: mode,
    businessId: business.id,
    business,
    businesses: [business],
    role,
    recommendationCount: state.recommendations.length,
    pendingRecommendationCount: state.recommendations.filter((item) => item.status === "pending").length,
  };
}

function containsOnlySyntheticRecords(state: AppState): boolean {
  return (
    state.products.every((product) => product.simulated === true) &&
    state.products.every((product) =>
      product.batches.every((batch) => batch.simulated === true),
    ) &&
    state.recommendations.every((recommendation) => recommendation.simulated === true) &&
    state.tasks.every((task) => task.simulated === true) &&
    state.activity.every((event) => event.simulated === true) &&
    state.invoiceIntakes.every((intake) => intake.simulated === true)
  );
}

function findInvoiceProposal(
  state: AppState,
  intakeId: string,
  proposalId: string,
): { intake: InvoiceIntake; proposal: InvoiceProposal } {
  const intake = state.invoiceIntakes.find((item) => item.id === intakeId);
  const proposal = intake?.proposals.find((item) => item.id === proposalId);
  if (!intake || !proposal) throw new Error("Invoice proposal not found in this shop.");
  if (proposal.status !== "pending") {
    throw new Error("This invoice proposal has already been reviewed.");
  }
  return { intake, proposal };
}

function validateProposalFields(
  fields: InvoiceProposalInput,
): InvoiceProposalInput {
  const normalized: InvoiceProposalInput = {
    productName: fields.productName.trim(),
    sku: fields.sku.trim().toUpperCase(),
    category: fields.category.trim(),
    quantity: fields.quantity,
    unit: fields.unit.trim(),
    batchId: fields.batchId.trim().toUpperCase(),
    expiryDate: fields.expiryDate.trim(),
    matchedProductId: fields.matchedProductId?.trim() || undefined,
  };
  for (const [label, value, max] of [
    ["Product name", normalized.productName, 160],
    ["SKU", normalized.sku, 60],
    ["Category", normalized.category, 60],
    ["Unit", normalized.unit, 40],
    ["Batch ID", normalized.batchId, 80],
    ["Expiry date", normalized.expiryDate, 30],
  ] as const) {
    if (value.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  }
  if (
    normalized.quantity !== null &&
    (typeof normalized.quantity !== "number" ||
      !Number.isFinite(normalized.quantity) ||
      normalized.quantity <= 0 ||
      normalized.quantity > 100_000)
  ) {
    throw new Error("Quantity must be a positive number no greater than 100,000.");
  }
  return normalized;
}

function updateProposalIssues(proposal: InvoiceProposal): void {
  const issues: string[] = [];
  if (!proposal.productName.trim()) issues.push("Product name not found.");
  if (!proposal.sku.trim()) issues.push("SKU not found.");
  if (proposal.quantity === null || proposal.quantity <= 0) {
    issues.push("Enter a valid positive quantity.");
  }
  if (!proposal.unit.trim()) issues.push("Unit not found.");
  if (!proposal.batchId.trim()) issues.push("Batch identifier not found.");
  if (!proposal.expiryDate.trim()) issues.push("Expiry date not found.");
  else if (!isValidInventoryDate(proposal.expiryDate)) {
    issues.push("Expiry date is invalid; enter a valid date.");
  }
  if (!proposal.category.trim()) {
    issues.push("Category not found; add one for a new product.");
  }
  proposal.issues = issues;
}

function updateIntakeStatus(intake: InvoiceIntake): void {
  intake.status = intake.proposals.every((proposal) => proposal.status !== "pending")
    ? "completed"
    : "review";
}

function addProposalConflicts(
  state: AppState,
  intake: InvoiceIntake,
  proposal: InvoiceProposal,
): void {
  const existing = state.products.find(
    (product) => product.sku.toUpperCase() === proposal.sku.toUpperCase(),
  );
  if (existing) {
    proposal.issues.push("This SKU already exists; explicitly match the existing product.");
    if (proposal.unit && existing.unit.toLowerCase() !== proposal.unit.toLowerCase()) {
      proposal.issues.push("The invoice unit conflicts with the existing product unit.");
    }
    if (proposal.productName && existing.name.toLowerCase() !== proposal.productName.toLowerCase()) {
      proposal.issues.push("The invoice name differs from the existing product name.");
    }
  }
  if (proposal.batchId && state.products.some((product) =>
    product.batches.some((batch) => batch.id.toUpperCase() === proposal.batchId.toUpperCase()),
  )) {
    proposal.issues.push("This batch identifier already exists in this shop.");
  }
  if (proposal.batchId && intake.proposals.some((other) =>
    other.id !== proposal.id &&
    other.status === "pending" &&
    other.batchId.toUpperCase() === proposal.batchId.toUpperCase(),
  )) {
    proposal.issues.push("Another invoice line uses this batch identifier.");
  }
}

function editInvoiceProposal(
  state: AppState,
  input: Extract<InventoryAction, { type: "edit_invoice_proposal" }>["payload"],
  now: string,
): void {
  requireDemoRole(input.role, "owner");
  const { intake, proposal } = findInvoiceProposal(
    state,
    input.intakeId,
    input.proposalId,
  );
  const fields = validateProposalFields(input.fields);
  Object.assign(proposal, fields);
  updateProposalIssues(proposal);
  addProposalConflicts(state, intake, proposal);
  addActivity(state, {
    type: "invoice_proposal_edited",
    title: "Invoice proposal edited",
    description: "An owner edited extracted fields; the proposal remains unverified.",
    occurredAt: now,
    invoiceId: intake.id,
    proposalId: proposal.id,
    simulated: false,
  });
}

function confirmInvoiceProposal(
  state: AppState,
  input: Extract<InventoryAction, { type: "confirm_invoice_proposal" }>["payload"],
  now: string,
): void {
  requireDemoRole(input.role, "owner");
  const { intake, proposal } = findInvoiceProposal(
    state,
    input.intakeId,
    input.proposalId,
  );
  const fields = validateProposalFields(input.fields);
  if (
    !fields.productName ||
    !fields.sku ||
    !fields.quantity ||
    !fields.unit ||
    !fields.batchId ||
    !isValidInventoryDate(fields.expiryDate)
  ) {
    throw new Error("Complete the product, quantity, unit, batch, and valid expiry date before confirming.");
  }
  if (
    state.products.some((product) =>
      product.batches.some((batch) => batch.id.toUpperCase() === fields.batchId),
    )
  ) {
    throw new Error("That batch ID is already in use in this shop.");
  }

  let product: Product;
  if (input.matchMode === "existing") {
    if (!fields.matchedProductId) {
      throw new Error("Choose an existing product or select Create new product.");
    }
    const existing = state.products.find((item) => item.id === fields.matchedProductId);
    if (!existing) throw new Error("The selected product is not in this shop.");
    if (existing.sku.toUpperCase() !== fields.sku.toUpperCase()) {
      throw new Error("The invoice SKU does not match the selected product. Review the product or SKU.");
    }
    if (existing.unit.toLowerCase() !== fields.unit.toLowerCase()) {
      throw new Error("The invoice unit does not match the selected product. Review the product or unit.");
    }
    product = existing;
  } else {
    if (!fields.category) throw new Error("Add a category before creating a new product.");
    if (state.products.some((item) => item.sku.toUpperCase() === fields.sku.toUpperCase())) {
      throw new Error("That SKU already exists. Match the existing product instead.");
    }
    product = {
      id: `product-${randomUUID()}`,
      name: fields.productName,
      sku: fields.sku,
      category: fields.category,
      unit: fields.unit,
      batches: [],
      simulated: false,
    };
    state.products.push(product);
  }

  const batchId = fields.batchId.toUpperCase();
  product.batches.push({
    id: batchId,
    productId: product.id,
    quantity: fields.quantity,
    expiryDate: fields.expiryDate,
    addedAt: now,
    simulated: false,
  });
  proposal.productName = product.name;
  proposal.sku = product.sku;
  proposal.category = product.category;
  proposal.quantity = fields.quantity;
  proposal.unit = product.unit;
  proposal.batchId = batchId;
  proposal.expiryDate = fields.expiryDate;
  proposal.status = "confirmed";
  proposal.matchedProductId = input.matchMode === "existing" ? product.id : undefined;
  proposal.issues = [];
  updateIntakeStatus(intake);

  addActivity(state, {
    type: "invoice_proposal_confirmed",
    title: "Invoice proposal confirmed",
    description: `${product.name} · batch ${batchId} was confirmed by the simulated owner.`,
    occurredAt: now,
    productId: product.id,
    batchId,
    invoiceId: intake.id,
    proposalId: proposal.id,
    simulated: false,
  });
  addActivity(state, {
    type: "inventory_added",
    title: "Invoice inventory added",
    description: `${product.name} · batch ${batchId} · ${fields.quantity} ${product.unit} · expiry ${fields.expiryDate}; confirmed from an uploaded supplier invoice.`,
    occurredAt: now,
    productId: product.id,
    batchId,
    invoiceId: intake.id,
    proposalId: proposal.id,
    simulated: false,
  });
}

function discardInvoiceProposal(
  state: AppState,
  input: Extract<InventoryAction, { type: "discard_invoice_proposal" }>["payload"],
  now: string,
): void {
  requireDemoRole(input.role, "owner");
  const { intake, proposal } = findInvoiceProposal(
    state,
    input.intakeId,
    input.proposalId,
  );
  proposal.status = "discarded";
  updateIntakeStatus(intake);
  addActivity(state, {
    type: "invoice_proposal_discarded",
    title: "Invoice proposal discarded",
    description: "An owner discarded this extracted line; no inventory was created.",
    occurredAt: now,
    invoiceId: intake.id,
    proposalId: proposal.id,
    simulated: false,
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
  if(batchIdHasHistory(state,batchId))throw new Error("This batch identifier is reserved by existing history. Use a new batch identifier.");
  if (!productName || !sku || !category || !unit || !batchId) {
    throw new Error("Complete every product and batch field.");
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100_000) {
    throw new Error("Quantity must be a whole number from 1 to 100,000.");
  }
  if (!isValidInventoryDate(input.expiryDate)) throw new Error("Enter a valid expiry date.");
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
      simulated: false,
    };
    state.products.push(product);
  } else if (product.unit.toLowerCase() !== unit.toLowerCase()) {
    throw new Error("Use the existing unit for this product SKU.");
  } else if (product.name.toLowerCase() !== productName.toLowerCase() || product.category.toLowerCase() !== category.toLowerCase()) {
    throw new Error("This SKU already exists. Use its stored product name and category, or edit the existing product.");
  }

  if (
    state.products.some((existing) =>
      existing.batches.some((batch) => batch.id === batchId || batch.previousIds?.includes(batchId)),
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
    simulated: false,
  });
  addActivity(state, {
    type: "inventory_added",
    title: "Inventory batch added",
    description: `${product.name} · batch ${batchId} · ${input.quantity} ${product.unit} · expires ${input.expiryDate}.`,
    occurredAt: now,
    productId: product.id,
    batchId,
  });
}

function editInventory(
  state: AppState,
  input: Extract<InventoryAction, { type: "edit_inventory" }>["payload"],
  now: string,
): void {
  const product = state.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("Product not found in this shop.");
  const batch = product.batches.find(
    (item) => item.id === input.originalBatchId,
  );
  if (!batch) throw new Error("Inventory batch not found in this shop.");

  const productName = input.productName.trim();
  const sku = input.sku.trim().toUpperCase();
  const category = input.category.trim();
  const unit = input.unit.trim();
  const batchId = input.batchId.trim().toUpperCase();
  if (!productName || !sku || !category || !unit || !batchId) {
    throw new Error("Complete every product and batch field.");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > 100_000) {
    throw new Error("Quantity must be positive and no greater than 100,000.");
  }
  if (!isValidInventoryDate(input.expiryDate)) {
    throw new Error("Enter a valid expiry date.");
  }
  const skuConflict = state.products.find(
    (item) => item.id !== product.id && item.sku.toUpperCase() === sku,
  );
  if (skuConflict) throw new Error("That SKU is already used by another product.");
  const batchConflict = state.products.some((item) =>
    item.batches.some(
      (other) =>
        other !== batch && (other.id.toUpperCase() === batchId || Boolean(other.previousIds?.includes(batchId))),
    ),
  );
  if (batchConflict) throw new Error("That batch ID is already in use.");

  const previous = {
    productName: product.name,
    sku: product.sku,
    category: product.category,
    unit: product.unit,
    batchId: batch.id,
    quantity: batch.quantity,
    expiryDate: batch.expiryDate,
  };
  if(previous.batchId!==batchId&&!batch.previousIds?.includes(batchId)&&batchIdHasHistory(state,batchId))throw new Error("This batch identifier is reserved by existing history.");
  if (previous.productName === productName && previous.sku === sku &&
      previous.category === category && previous.unit === unit &&
      previous.batchId === batchId && previous.quantity === input.quantity &&
      previous.expiryDate === input.expiryDate) {
    throw new Error("No inventory changes to save.");
  }
  if(previous.unit!==unit&&(state.movements??[]).some(m=>m.productId===product.id))throw new Error("Units cannot be rewritten after stock movements. Use a new product for a different unit.");
  if(previous.batchId!==batchId)batch.previousIds=[...(batch.previousIds??[]),previous.batchId];
  product.name = productName;
  product.sku = sku;
  product.category = category;
  product.unit = unit;
  batch.id = batchId;
  batch.quantity = input.quantity;
  batch.expiryDate = input.expiryDate;

  if (previous.batchId !== batch.id) {
    // Keep workflow links attached to the same stored batch when its label changes.
    // Activity descriptions retain the original labels as an audit trail.
    for (const recommendation of state.recommendations) {
      if (recommendation.productId === product.id && recommendation.batchId === previous.batchId) {
        recommendation.batchId = batch.id;
      }
    }
    for (const task of state.tasks) {
      if (task.productId === product.id && task.batchId === previous.batchId) task.batchId = batch.id;
    }
  }

  // Open work uses current stock details. Completed reports remain historical.
  for (const task of state.tasks) {
    if (task.status !== "open" || task.productId !== product.id) continue;
    const currentBatch = product.batches.find((item) => item.id === task.batchId);
    if (!currentBatch) continue;
    task.productName = product.name;
    task.sku = product.sku;
    task.unit = product.unit;
    task.quantity = currentBatch.quantity;
    task.expiryDate = currentBatch.expiryDate;
    task.title = `${task.riskType === "expired" ? "Inspect" : "Rotate"} ${product.name} · ${currentBatch.id}`;
  }

  addActivity(state, {
    type: "inventory_edited",
    title: "Inventory batch updated",
    description: `${previous.productName} · ${previous.batchId} was updated to ${product.name} · ${batch.id}; quantity ${previous.quantity} ${previous.unit} → ${batch.quantity} ${product.unit}; expiry ${previous.expiryDate} → ${batch.expiryDate}.`,
    occurredAt: now,
    productId: product.id,
    batchId: batch.id,
  });
}

function deleteInventory(
  state: AppState,
  input: Extract<InventoryAction, { type: "delete_inventory" }>["payload"],
  now: string,
): void {
  if (input.confirmed !== true) {
    throw new Error("Confirm deletion of this inventory batch before continuing.");
  }
  const product = state.products.find((item) => item.id === input.productId);
  if (!product) throw new Error("Product not found in this shop.");
  const batch = product.batches.find((item) => item.id === input.batchId);
  if (!batch) throw new Error("Inventory batch not found in this shop.");
  if (state.tasks.some((task) => task.status === "open" && task.productId === product.id && task.batchId === batch.id)) {
    throw new Error("Complete the open staff task before deleting this inventory batch.");
  }
  product.batches = product.batches.filter((item) => item.id !== batch.id);
  addActivity(state, {
    type: "inventory_deleted",
    title: "Inventory batch deleted",
    description: `${product.name} · batch ${batch.id} (${batch.quantity} ${product.unit}, expiry ${batch.expiryDate}) was removed from inventory.`,
    occurredAt: now,
    productId: product.id,
    batchId: batch.id,
    simulated: product.simulated && batch.simulated,
  });
}

function approveRecommendation(
  state: AppState,
  input: Extract<InventoryAction, { type: "approve" }>["payload"],
  now: string,
): void {
  requireDemoRole(input.role, "owner");
  const recommendation = requirePendingRecommendation(
    state,
    input.recommendationId,
  );
  if (
    state.tasks.some((task) => task.recommendationId === recommendation.id)
  ) {
    throw new Error("This recommendation already has a linked staff task.");
  }
  const assignedTo = input.assignedTo.trim();
  if (!assignedTo || assignedTo.length > 60) {
    throw new Error("Choose a staff member using 60 characters or fewer.");
  }
  recommendation.status = "approved";
  recommendation.decisionAt = now;
  recommendation.decisionBy = "Simulated owner";
  addActivity(state, {
    type: "approved",
    title: "Recommendation approved",
    description: `${recommendation.productName} · batch ${recommendation.batchId} was approved by the simulated owner.`,
    occurredAt: now,
    actor: "simulated_owner",
    productId: recommendation.productId,
    batchId: recommendation.batchId,
    recommendationId: recommendation.id,
  });
  const task: StaffTask = {
    id: `task-${randomUUID()}`,
    recommendationId: recommendation.id,
    productId: recommendation.productId,
    batchId: recommendation.batchId,
    productName: recommendation.productName,
    sku: recommendation.sku,
    quantity: recommendation.quantity,
    unit: recommendation.unit,
    expiryDate: recommendation.expiryDate,
    riskType: recommendation.riskType,
    title: `${recommendation.riskType === "expired" ? "Inspect" : "Rotate"} ${recommendation.productName} · ${recommendation.batchId}`,
    instruction: recommendation.suggestedAction,
    assignedTo,
    status: "open",
    progressType: "not_started",
    createdAt: now,
    simulated: recommendation.simulated,
  };
  state.tasks.push(task);
  addActivity(state, {
    type: "task_created",
    title: "Staff task created",
    description: `${task.title} was created after owner approval.`,
    occurredAt: now,
    productId: task.productId,
    batchId: task.batchId,
    recommendationId: task.recommendationId,
    taskId: task.id,
  });
  addActivity(state, {
    type: "task_assigned",
    title: "Task assigned",
    description: `${task.title} was assigned to ${assignedTo}.`,
    occurredAt: now,
    actor: "simulated_owner",
    productId: task.productId,
    batchId: task.batchId,
    recommendationId: task.recommendationId,
    taskId: task.id,
  });
}

function rejectRecommendation(
  state: AppState,
  input: Extract<InventoryAction, { type: "reject" }>["payload"],
  now: string,
): void {
  requireDemoRole(input.role, "owner");
  const recommendation = requirePendingRecommendation(
    state,
    input.recommendationId,
  );
  if (
    state.tasks.some((task) => task.recommendationId === recommendation.id)
  ) {
    throw new Error("This recommendation already has a linked staff task.");
  }
  if (input.reason && input.reason.length > 250) {
    throw new Error("Rejection reason must be 250 characters or fewer.");
  }
  recommendation.status = "rejected";
  recommendation.decisionAt = now;
  recommendation.decisionBy = "Simulated owner";
  const reason = input.reason?.trim();
  addActivity(state, {
    type: "rejected",
    title: "Recommendation rejected",
    description: `${recommendation.productName} · batch ${recommendation.batchId} was rejected by the simulated owner.${reason ? ` Reason: ${reason}` : ""}`,
    occurredAt: now,
    actor: "simulated_owner",
    productId: recommendation.productId,
    batchId: recommendation.batchId,
    recommendationId: recommendation.id,
  });
}

function updateTaskProgress(
  state: AppState,
  input: Extract<InventoryAction, { type: "update_task_progress" }>["payload"],
  now: string,
): void {
  const task = state.tasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status !== "open") throw new Error("A completed task cannot have its progress changed.");
  if (!TASK_PROGRESS_TYPES.includes(input.progressType)) throw new Error("Choose a valid task progress status.");
  const note = input.progressNote?.trim();
  if (note && note.length > 500) throw new Error("Progress note must be 500 characters or fewer.");
  if (input.progressType === "blocked" && (!note || note.length < 3)) {
    throw new Error("Explain why the task is blocked in at least 3 characters.");
  }
  if ((task.progressType ?? "not_started") === input.progressType && task.progressNote === note) {
    throw new Error("No task progress changes to save.");
  }
  task.progressType = input.progressType;
  task.progressNote = note;
  addActivity(state, {
    type: "task_progress_updated",
    title: "Task progress updated",
    description: `${task.title}: ${TASK_PROGRESS_LABELS[input.progressType]}.${note ? ` Note: ${note}` : ""}`,
    occurredAt: now,
    actor: input.role === "staff" ? "simulated_staff" : "simulated_owner",
    productId: task.productId,
    batchId: task.batchId,
    recommendationId: task.recommendationId,
    taskId: task.id,
    simulated: task.simulated,
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
  if (!TASK_OUTCOME_TYPES.includes(input.outcomeType)) {
    throw new Error("Choose a valid staff-reported outcome.");
  }
  const explanation = input.outcomeExplanation?.trim();
  if (explanation && explanation.length > 500) {
    throw new Error("Outcome explanation must be 500 characters or fewer.");
  }
  if (input.outcomeType === "other" && (!explanation || explanation.length < 3)) {
    throw new Error("Explain the Other outcome in at least 3 characters.");
  }
  const outcome = explanation
    ? `${TASK_OUTCOME_LABELS[input.outcomeType]}: ${explanation}`
    : TASK_OUTCOME_LABELS[input.outcomeType];
  task.status = "completed";
  task.completedAt = now;
  task.outcome = outcome;
  task.outcomeType = input.outcomeType;
  task.outcomeExplanation = explanation;
  const actor = input.role === "staff" ? "simulated_staff" : "simulated_owner";
  const actorLabel = input.role === "staff" ? "staff" : "owner";
  addActivity(state, {
    type: "task_completed",
    title: "Staff task completed",
    description: `${task.title} was marked complete by the simulated ${actorLabel} role. Reported outcome: ${outcome}. Inventory quantities were not changed.`,
    occurredAt: now,
    actor,
    productId: task.productId,
    batchId: task.batchId,
    recommendationId: task.recommendationId,
    taskId: task.id,
  });
}

function requireDemoRole(
  role: Role | undefined,
  expectedRole: Role,
): void {
  if (role !== expectedRole) {
    const label = expectedRole === "owner" ? "Owner" : "Staff";
    throw new Error(`Switch to the ${label} role view to perform this action.`);
  }
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
  input: Omit<ActivityEvent, "id" | "simulated"> & { simulated?: boolean },
): void {
  state.activity.push({
    ...input,
    actor: input.actor ?? "system",
    id: `event-${randomUUID()}`,
    simulated: input.simulated ?? false,
  });
}

function isValidInventoryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported action: ${JSON.stringify(value)}`);
}

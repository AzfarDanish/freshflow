import {
  bigint,
  boolean,
  check,
  customType,
  index,
  bigserial,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AppState } from "@/src/lib/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => value as Buffer,
});

// Row level security is enabled and forced on FreshFlow's runtime tables. The only
// policies target the app's own least-privilege role, so the anon/authenticated
// Data API surface stays denied by default.
const appAccess = () => ({
  as: "permissive" as const,
  for: "all" as const,
  to: "freshflow_app",
  using: sql`true`,
  withCheck: sql`true`,
});

const policy = (table: string) => pgPolicy(`freshflow_app_all_${table}`, appAccess());
const businessStatesPolicy = pgPolicy("freshflow_app_all_freshflow_business_state", appAccess());
const invoiceDocumentsPolicy = pgPolicy("freshflow_app_all_freshflow_invoice_documents", appAccess());
const membershipsPolicy = pgPolicy("freshflow_app_all_freshflow_memberships", appAccess());
const stateBackupsPolicy = pgPolicy("freshflow_app_all_freshflow_state_backups", appAccess());

// Money is stored as integer minor units (sen), quantities carry up to four
// decimal places, and dates the app compares as plain strings (expiry dates,
// business-day references) stay text so round-trips are exact.
const money = (name: string) => bigint(name, { mode: "number" });
const qty = (name: string) => numeric(name, { precision: 12, scale: 4, mode: "number" });

// Timestamps: app-generated ISO strings are stored as timestamptz. User-supplied
// timestamps keep their exact original string (movements.occurred_at) because
// idempotency checks compare those raw strings.
const isoTs = (name: string) => timestamp(name, { withTimezone: true });

const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
// sortSeq reproduces the in-memory array order of AppState entities (insertion order).
const sortSeq = () => bigserial("sort_seq", { mode: "number" }).notNull();

const ACTIVITY_TYPES = "'risk_detected','approved','rejected','task_created','task_assigned','task_completed','task_progress_updated','inventory_added','inventory_edited','inventory_deleted','invoice_uploaded','invoice_proposal_edited','invoice_proposal_confirmed','invoice_proposal_discarded','settings_changed','movement_recorded','movement_reversed','invoice_received','invoice_updated','invoice_processing','invoice_cancelled','member_changed','legacy_cleanup','demo_reset'";

export const businesses = pgTable("freshflow_businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  simulated: boolean("simulated").notNull().default(false),
  thresholdDays: bigint("threshold_days", { mode: "number" }).notNull().default(7),
  demoDate: text("demo_date").notNull(),
  timeZone: text("time_zone").notNull().default("Asia/Kuala_Lumpur"),
  currency: text("currency").notNull().default("MYR"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [policy("freshflow_businesses")]).enableRLS();

export const products = pgTable("freshflow_products", {
  businessId: text("business_id").notNull().references(() => businesses.id),
  id: text("id").notNull(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  simulated: boolean("simulated").notNull().default(false),
  sortSeq: sortSeq(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  uniqueIndex("freshflow_products_sku_unique").on(table.businessId, sql`upper(${table.sku})`),
  policy("freshflow_products"),
]).enableRLS();

export const batches = pgTable("freshflow_batches", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  productId: text("product_id").notNull(),
  quantity: qty("quantity").notNull(),
  expiryDate: text("expiry_date").notNull().default(""),
  expiryNotApplicable: boolean("expiry_not_applicable").notNull().default(false),
  previousIds: text("previous_ids").array().notNull().default(sql`'{}'::text[]`),
  addedAt: isoTs("added_at").notNull(),
  simulated: boolean("simulated").notNull().default(false),
  sortSeq: sortSeq(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("freshflow_batches_quantity_nonnegative", sql`${table.quantity} >= 0`),
  foreignKey({ columns: [table.businessId, table.productId], foreignColumns: [products.businessId, products.id], name: "freshflow_batches_product_fk" }),
  policy("freshflow_batches"),
]).enableRLS();

export const recommendations = pgTable("freshflow_recommendations", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  productId: text("product_id").notNull(),
  batchId: text("batch_id").notNull(),
  productName: text("product_name").notNull(),
  sku: text("sku").notNull(),
  quantity: qty("quantity").notNull(),
  unit: text("unit").notNull(),
  expiryDate: text("expiry_date").notNull(),
  daysUntilExpiry: bigint("days_until_expiry", { mode: "number" }).notNull(),
  riskType: text("risk_type").$type<"expired" | "approaching">().notNull(),
  suggestedAction: text("suggested_action").notNull(),
  explanation: text("explanation").notNull(),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
  createdAt: isoTs("created_at").notNull(),
  decisionAt: isoTs("decision_at"),
  decisionBy: text("decision_by"),
  simulated: boolean("simulated").notNull().default(false),
  sortSeq: sortSeq(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("freshflow_recommendations_risk_type", sql`${table.riskType} in ('expired','approaching')`),
  check("freshflow_recommendations_status", sql`${table.status} in ('pending','approved','rejected')`),
  index("freshflow_recommendations_product_batch_idx").on(table.businessId, table.productId, table.batchId),
  policy("freshflow_recommendations"),
]).enableRLS();

export const tasks = pgTable("freshflow_tasks", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  recommendationId: text("recommendation_id").notNull(),
  productId: text("product_id"),
  batchId: text("batch_id"),
  productName: text("product_name"),
  sku: text("sku"),
  quantity: qty("quantity"),
  unit: text("unit"),
  expiryDate: text("expiry_date"),
  riskType: text("risk_type").$type<"expired" | "approaching">(),
  title: text("title").notNull(),
  instruction: text("instruction").notNull(),
  assignedTo: text("assigned_to").notNull(),
  status: text("status").$type<"open" | "completed">().notNull().default("open"),
  progressType: text("progress_type").$type<"not_started" | "in_progress" | "blocked">(),
  progressNote: text("progress_note"),
  completedAt: isoTs("completed_at"),
  outcome: text("outcome"),
  outcomeType: text("outcome_type")
    .$type<"rotated" | "removed_from_shelf" | "reported_to_owner" | "no_action_taken" | "other">(),
  outcomeExplanation: text("outcome_explanation"),
  createdAt: isoTs("created_at").notNull(),
  simulated: boolean("simulated").notNull().default(false),
  sortSeq: sortSeq(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("freshflow_tasks_status", sql`${table.status} in ('open','completed')`),
  check("freshflow_tasks_risk_type", sql`${table.riskType} is null or ${table.riskType} in ('expired','approaching')`),
  check("freshflow_tasks_progress_type", sql`${table.progressType} is null or ${table.progressType} in ('not_started','in_progress','blocked')`),
  check("freshflow_tasks_outcome_type", sql`${table.outcomeType} is null or ${table.outcomeType} in ('rotated','removed_from_shelf','reported_to_owner','no_action_taken','other')`),
  foreignKey({ columns: [table.businessId, table.recommendationId], foreignColumns: [recommendations.businessId, recommendations.id], name: "freshflow_tasks_recommendation_fk" }),
  index("freshflow_tasks_recommendation_idx").on(table.businessId, table.recommendationId),
  policy("freshflow_tasks"),
]).enableRLS();

export const activity = pgTable("freshflow_activity", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  occurredAt: isoTs("occurred_at").notNull(),
  actor: text("actor").$type<"system" | "owner" | "staff" | "simulated_owner" | "simulated_staff">(),
  actorId: text("actor_id"),
  productId: text("product_id"),
  batchId: text("batch_id"),
  recommendationId: text("recommendation_id"),
  taskId: text("task_id"),
  invoiceId: text("invoice_id"),
  proposalId: text("proposal_id"),
  simulated: boolean("simulated").notNull().default(false),
  sortSeq: sortSeq(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("freshflow_activity_type", sql`${table.type} in (${sql.raw(ACTIVITY_TYPES)})`),
  index("freshflow_activity_seq_idx").on(table.businessId, table.sortSeq),
  policy("freshflow_activity"),
]).enableRLS();

export const movements = pgTable("freshflow_movements", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  requestId: text("request_id").notNull(),
  productId: text("product_id").notNull(),
  batchId: text("batch_id").notNull(),
  productName: text("product_name").notNull(),
  sku: text("sku").notNull(),
  unit: text("unit").notNull(),
  kind: text("kind").$type<"opening" | "receipt" | "sale" | "waste" | "adjustment" | "reversal">().notNull(),
  quantity: qty("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor"),
  unitCostMinor: money("unit_cost_minor"),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: isoTs("recorded_at").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  invoiceId: text("invoice_id"),
  proposalId: text("proposal_id"),
  reversesId: text("reverses_id"),
  sortSeq: sortSeq(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("freshflow_movements_kind", sql`${table.kind} in ('opening','receipt','sale','waste','adjustment','reversal')`),
  check("freshflow_movements_quantity_nonzero", sql`${table.quantity} <> 0`),
  uniqueIndex("freshflow_movements_request_unique").on(table.businessId, table.requestId),
  index("freshflow_movements_seq_idx").on(table.businessId, table.sortSeq),
  policy("freshflow_movements"),
]).enableRLS();

export const suppliers = pgTable("freshflow_suppliers", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  reference: text("reference"),
  createdAt: createdAt(),
  sortSeq: sortSeq(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  uniqueIndex("freshflow_suppliers_name_unique").on(table.businessId, sql`lower(${table.name})`),
  policy("freshflow_suppliers"),
]).enableRLS();

export const invoices = pgTable("freshflow_invoices", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: money("file_size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  uploadedAt: isoTs("uploaded_at").notNull(),
  status: text("status").$type<"review" | "completed" | "partial" | "cancelled" | "failed">().notNull().default("review"),
  warnings: text("warnings").array().notNull().default(sql`'{}'::text[]`),
  headerSupplierId: text("header_supplier_id"),
  headerSupplierName: text("header_supplier_name"),
  headerInvoiceNumber: text("header_invoice_number"),
  headerInvoiceDate: text("header_invoice_date"),
  headerTaxMinor: money("header_tax_minor"),
  headerTotalMinor: money("header_total_minor"),
  processingStatus: text("processing_status").$type<"processing" | "review" | "failed" | "cancelled">(),
  processingError: text("processing_error"),
  processingStartedAt: isoTs("processing_started_at"),
  uploadRequestId: text("upload_request_id"),
  simulated: boolean("simulated").notNull().default(false),
  sortSeq: sortSeq(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  check("freshflow_invoices_mime_type", sql`${table.mimeType} in ('application/pdf','text/csv','image/png','image/jpeg')`),
  check("freshflow_invoices_status", sql`${table.status} in ('review','completed','partial','cancelled','failed')`),
  uniqueIndex("freshflow_invoices_sha_unique").on(table.businessId, table.sha256),
  policy("freshflow_invoices"),
]).enableRLS();

export const invoiceProposals = pgTable("freshflow_invoice_proposals", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  intakeId: text("intake_id").notNull(),
  productName: text("product_name").notNull(),
  sku: text("sku").notNull(),
  category: text("category").notNull(),
  quantity: qty("quantity"),
  unit: text("unit").notNull(),
  batchId: text("batch_id").notNull(),
  expiryDate: text("expiry_date").notNull(),
  status: text("status").$type<"pending" | "confirmed" | "discarded">().notNull().default("pending"),
  issues: text("issues").array().notNull().default(sql`'{}'::text[]`),
  matchedProductId: text("matched_product_id"),
  unitPriceMinor: money("unit_price_minor"),
  taxMinor: money("tax_minor"),
  receivedQuantity: qty("received_quantity"),
  sortSeq: sortSeq(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.intakeId, table.id] }),
  check("freshflow_invoice_proposals_status", sql`${table.status} in ('pending','confirmed','discarded')`),
  foreignKey({ columns: [table.businessId, table.intakeId], foreignColumns: [invoices.businessId, invoices.id], name: "freshflow_invoice_proposals_intake_fk" }),
  index("freshflow_invoice_proposals_intake_idx").on(table.businessId, table.intakeId),
  policy("freshflow_invoice_proposals"),
]).enableRLS();

export const invoiceReceipts = pgTable("freshflow_invoice_receipts", {
  businessId: text("business_id").notNull(),
  id: text("id").notNull(),
  intakeId: text("intake_id").notNull(),
  requestId: text("request_id").notNull(),
  fingerprint: text("fingerprint"),
  receivedAt: isoTs("received_at").notNull(),
  actorId: text("actor_id").notNull(),
  discrepancyReason: text("discrepancy_reason"),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.id] }),
  foreignKey({ columns: [table.businessId, table.intakeId], foreignColumns: [invoices.businessId, invoices.id], name: "freshflow_invoice_receipts_intake_fk" }),
  uniqueIndex("freshflow_invoice_receipts_request_unique").on(table.businessId, table.intakeId, table.requestId),
  policy("freshflow_invoice_receipts"),
]).enableRLS();

export const invoiceReceiptLines = pgTable("freshflow_invoice_receipt_lines", {
  businessId: text("business_id").notNull(),
  receiptId: text("receipt_id").notNull(),
  lineIndex: bigint("line_index", { mode: "number" }).notNull(),
  proposalId: text("proposal_id").notNull(),
  productId: text("product_id").notNull(),
  batchId: text("batch_id").notNull(),
  quantity: qty("quantity").notNull(),
  expiryDate: text("expiry_date").notNull(),
  unitCostMinor: money("unit_cost_minor"),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.receiptId, table.lineIndex] }),
  foreignKey({ columns: [table.businessId, table.receiptId], foreignColumns: [invoiceReceipts.businessId, invoiceReceipts.id], name: "freshflow_invoice_receipt_lines_receipt_fk" }),
  policy("freshflow_invoice_receipt_lines"),
]).enableRLS();

export const invoiceCorrections = pgTable("freshflow_invoice_corrections", {
  businessId: text("business_id").notNull(),
  correctionSeq: bigserial("correction_seq", { mode: "number" }).notNull(),
  intakeId: text("intake_id").notNull(),
  at: isoTs("at").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  // Historical payload snapshots vary with what was corrected; JSONB is the
  // honest representation for this one open-shaped column.
  before: jsonb("before").$type<unknown>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.businessId, table.correctionSeq] }),
  foreignKey({ columns: [table.businessId, table.intakeId], foreignColumns: [invoices.businessId, invoices.id], name: "freshflow_invoice_corrections_intake_fk" }),
  index("freshflow_invoice_corrections_intake_idx").on(table.businessId, table.intakeId),
  policy("freshflow_invoice_corrections"),
]).enableRLS();

// ---------- Legacy / unchanged tables ----------

export const businessStates = pgTable("freshflow_business_state", {
  businessId: text("business_id").primaryKey(),
  state: jsonb("state").$type<AppState>().notNull(),
  updatedAt: updatedAt(),
}, (table) => [businessStatesPolicy]).enableRLS();

export const invoiceDocuments = pgTable("freshflow_invoice_documents", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
  contents: bytea("contents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [invoiceDocumentsPolicy]).enableRLS();

export const memberships = pgTable("freshflow_memberships", {
  userId: text("user_id").notNull(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id),
  role: text("role").$type<"owner" | "staff">().notNull(),
  active: boolean("active").notNull().default(true),
  grantedBy: text("granted_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.businessId] }), membershipsPolicy]).enableRLS();

export const stateBackups = pgTable("freshflow_state_backups", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull(),
  state: jsonb("state").$type<AppState>().notNull(),
  digest: text("digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [stateBackupsPolicy]).enableRLS();

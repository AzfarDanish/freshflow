import {
  bigint,
  customType,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AppState } from "@/src/lib/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => value as Buffer,
});

export const businessStates = pgTable("freshflow_business_state", {
  businessId: text("business_id").primaryKey(),
  state: jsonb("state").$type<AppState>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
});

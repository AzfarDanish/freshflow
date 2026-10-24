import type { Role } from "./types";

export type MovementKind = "opening" | "receipt" | "sale" | "waste" | "adjustment" | "reversal";
export interface StockMovement {
  id: string;
  requestId: string;
  productId: string;
  batchId: string;
  productName: string;
  sku: string;
  unit: string;
  kind: MovementKind;
  quantity: number;
  unitPriceMinor?: number;
  unitCostMinor?: number;
  occurredAt: string;
  recordedAt: string;
  actorId: string;
  reason: string;
  invoiceId?: string;
  proposalId?: string;
  reversesId?: string;
  previousQuantity?: number;
  correctedQuantity?: number;
}
export interface Supplier { id: string; name: string; reference?: string }
export interface InvoiceHeader {
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  taxMinor?: number;
  totalMinor?: number;
}
export interface InvoiceReceipt {
  id: string;
  requestId: string;
  fingerprint?: string;
  receivedAt: string;
  actorId: string;
  discrepancyReason?: string;
  lines: { proposalId: string; productId: string; batchId: string; quantity: number; expiryDate: string; unitCostMinor?: number }[];
}
export interface InvoiceCorrection { at: string; actorId: string; reason: string; before: unknown }
export interface WasteByReason {
  reason: string;
  count: number;
  quantityByUnit: Record<string, number>;
  costMinor: number | null;
}

export interface ProductWasteBreakdown {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  wastedQuantity: number;
  wasteCostMinor: number | null;
  unknownCostCount: number;
  wasteEventsCount: number;
}

export interface OperationsSummary {
  wasteUnits: number;
  wasteCostMinor: number | null;
  unknownCosts: number;
  currency: string;
  from: string;
  to: string;
  daily: { date: string; wasteCostMinor: number | null; waste: number }[];
  limitations: string[];
  quantityByUnit: Record<string, { wasted: number }>;
  wasteByReason: WasteByReason[];
  productBreakdown: ProductWasteBreakdown[];
  // Deprecated/removed sales tracking fields
  saleUnits?: number;
  saleRevenueMinor?: number | null;
  unknownPrices?: number;
}
export interface OperationsResponse {
  movements: StockMovement[];
  suppliers: Supplier[];
  summary: OperationsSummary;
}
export interface EvidenceRecord { id: string; kind: string; label: string; facts: Record<string, unknown> }
export interface AssistantResponse { answer: string; evidence: EvidenceRecord[]; computedAt: string; limitations: string[] }
export interface BusinessIdentity { userId: string; businessId: string; actualRole: Role; role: Role }

export type PersistenceMode = "postgres" | "test_local";
export type RecommendationStatus = "pending" | "approved" | "rejected";
export type TaskStatus = "open" | "completed";
export type TaskProgressType = "not_started" | "in_progress" | "blocked";
export type RiskType = "expired" | "approaching";
export type InvoiceIntakeStatus = "review" | "completed" | "partial" | "cancelled" | "failed";
export type InvoiceProposalStatus = "pending" | "confirmed" | "discarded";
export type TaskOutcomeType =
  | "rotated"
  | "removed_from_shelf"
  | "reported_to_owner"
  | "no_action_taken"
  | "other";
export type Role = "owner" | "staff";
export type ActivityActor = "system" | "owner" | "staff" | "simulated_owner" | "simulated_staff";

export const TASK_OUTCOME_TYPES: TaskOutcomeType[] = [
  "rotated",
  "removed_from_shelf",
  "reported_to_owner",
  "no_action_taken",
  "other",
];

export const TASK_OUTCOME_LABELS: Record<TaskOutcomeType, string> = {
  rotated: "Rotated stock",
  removed_from_shelf: "Removed from shelf",
  reported_to_owner: "Reported to owner",
  no_action_taken: "No action taken",
  other: "Other",
};

export const TASK_PROGRESS_TYPES: TaskProgressType[] = ["not_started", "in_progress", "blocked"];
export const TASK_PROGRESS_LABELS: Record<TaskProgressType, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
};

export interface BusinessWorkspace {
  id: string;
  name: string;
  simulated: boolean;
}

export interface InventoryBatch {
  id: string;
  productId: string;
  quantity: number;
  expiryDate: string;
  expiryNotApplicable?: boolean;
  previousIds?: string[];
  addedAt: string;
  simulated: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  batches: InventoryBatch[];
  simulated: boolean;
}

export interface Recommendation {
  id: string;
  batchId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unit: string;
  expiryDate: string;
  daysUntilExpiry: number;
  riskType: RiskType;
  suggestedAction: string;
  explanation: string;
  status: RecommendationStatus;
  createdAt: string;
  decisionAt?: string;
  decisionBy?: string;
  simulated: boolean;
}

export interface StaffTask {
  id: string;
  recommendationId: string;
  productId?: string;
  batchId?: string;
  productName?: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  expiryDate?: string;
  riskType?: RiskType;
  title: string;
  instruction: string;
  assignedTo: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  outcome?: string;
  outcomeType?: TaskOutcomeType;
  outcomeExplanation?: string;
  progressType?: TaskProgressType;
  progressNote?: string;
  simulated: boolean;
}

export interface InvoiceProposal {
  id: string;
  productName: string;
  sku: string;
  category: string;
  quantity: number | null;
  unit: string;
  batchId: string;
  expiryDate: string;
  status: InvoiceProposalStatus;
  issues: string[];
  matchedProductId?: string;
  unitPriceMinor?: number;
  taxMinor?: number;
  receivedQuantity?: number;
}

export interface InvoiceIntake {
  id: string;
  fileName: string;
  mimeType: "application/pdf" | "text/csv" | "image/png" | "image/jpeg";
  fileSizeBytes: number;
  sha256: string;
  uploadedAt: string;
  status: InvoiceIntakeStatus;
  warnings: string[];
  proposals: InvoiceProposal[];
  simulated: boolean;
  header?: import("./operational-types").InvoiceHeader;
  receipts?: import("./operational-types").InvoiceReceipt[];
  corrections?: import("./operational-types").InvoiceCorrection[];
  processingStatus?: "processing" | "review" | "failed" | "cancelled";
  processingError?: string;
  processingStartedAt?: string;
  uploadRequestId?: string;
}

export interface ActivityEvent {
  id: string;
  type:
    | "risk_detected"
    | "approved"
    | "rejected"
    | "task_created"
    | "task_assigned"
    | "task_completed"
    | "task_progress_updated"
    | "inventory_added"
    | "inventory_edited"
    | "inventory_deleted"
    | "invoice_uploaded"
    | "invoice_proposal_edited"
    | "invoice_proposal_confirmed"
    | "invoice_proposal_discarded"
    | "settings_changed"
    | "movement_recorded"
    | "movement_reversed"
    | "invoice_received"
    | "invoice_updated"
    | "invoice_processing"
    | "invoice_cancelled"
    | "member_changed"
    | "legacy_cleanup"
    | "demo_reset";
  title: string;
  description: string;
  occurredAt: string;
  actor?: ActivityActor;
  productId?: string;
  batchId?: string;
  recommendationId?: string;
  taskId?: string;
  invoiceId?: string;
  proposalId?: string;
  simulated: boolean;
  actorId?: string;
}

export interface AppSettings {
  thresholdDays: number;
  demoDate: string;
  timeZone?: string;
  currency?: string;
}

export interface AppState {
  products: Product[];
  recommendations: Recommendation[];
  tasks: StaffTask[];
  activity: ActivityEvent[];
  invoiceIntakes: InvoiceIntake[];
  settings: AppSettings;
  movements?: import("./operational-types").StockMovement[];
  suppliers?: import("./operational-types").Supplier[];
}

export interface InvoiceProposalInput {
  productName: string;
  sku: string;
  category: string;
  quantity: number | null;
  unit: string;
  batchId: string;
  expiryDate: string;
  matchedProductId?: string;
}

export type InventoryAction =
  | {
      type: "add_inventory";
      payload: {
        productName: string;
        sku: string;
        category: string;
        unit: string;
        batchId: string;
        quantity: number;
        expiryDate: string;
      };
    }
  | {
      type: "edit_inventory";
      payload: {
        productId: string;
        originalBatchId: string;
        batchId: string;
        productName: string;
        sku: string;
        category: string;
        unit: string;
        quantity: number;
        expiryDate: string;
      };
    }
  | {
      type: "delete_inventory";
      payload: { productId: string; batchId: string; confirmed: true };
    }
  | {
      type: "edit_invoice_proposal";
      payload: {
        intakeId: string;
        proposalId: string;
        fields: InvoiceProposalInput;
        role?: "owner" | "staff";
      };
    }
  | {
      type: "confirm_invoice_proposal";
      payload: {
        intakeId: string;
        proposalId: string;
        fields: InvoiceProposalInput;
        matchMode: "existing" | "new";
        role?: "owner" | "staff";
      };
    }
  | {
      type: "discard_invoice_proposal";
      payload: {
        intakeId: string;
        proposalId: string;
        role?: "owner" | "staff";
      };
    }
  | { type: "set_threshold"; payload: { thresholdDays: number } }
  | {
      type: "approve";
      payload: {
        recommendationId: string;
        assignedTo: string;
        customInstruction?: string;
        role?: "owner" | "staff";
      };
    }
  | {
      type: "reject";
      payload: { recommendationId: string; reason?: string; role?: "owner" | "staff" };
    }
  | {
      type: "update_task_progress";
      payload: {
        taskId: string;
        progressType: TaskProgressType;
        progressNote?: string;
        role?: Role;
      };
    }
  | {
      type: "complete_task";
      payload: {
        taskId: string;
        outcomeType: TaskOutcomeType;
        outcomeExplanation?: string;
        role?: "owner" | "staff";
      };
    }
  | { type: "reset"; payload: { confirmed: true } };

export interface StateResponse {
  state: AppState;
  persistenceMode: PersistenceMode;
  businessId: string;
  business: BusinessWorkspace;
  businesses: BusinessWorkspace[];
  role?: Role;
  recommendationCount?: number;
  pendingRecommendationCount?: number;
}

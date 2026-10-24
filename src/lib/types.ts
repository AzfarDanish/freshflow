export type PersistenceMode = "local_demo" | "supabase";
export type RecommendationStatus = "pending" | "approved" | "rejected";
export type TaskStatus = "open" | "completed";
export type RiskType = "expired" | "approaching";
export type TaskOutcomeType =
  | "rotated"
  | "removed_from_shelf"
  | "reported_to_owner"
  | "no_action_taken"
  | "other";
export type ActivityActor = "system" | "simulated_owner" | "simulated_staff";

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

export interface BusinessWorkspace {
  id: string;
  name: string;
  simulated: true;
}

export interface InventoryBatch {
  id: string;
  productId: string;
  quantity: number;
  expiryDate: string;
  addedAt: string;
  simulated: true;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  batches: InventoryBatch[];
  simulated: true;
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
  simulated: true;
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
  simulated: true;
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
    | "inventory_added"
    | "inventory_edited"
    | "settings_changed"
    | "demo_reset";
  title: string;
  description: string;
  occurredAt: string;
  actor?: ActivityActor;
  productId?: string;
  batchId?: string;
  recommendationId?: string;
  taskId?: string;
  simulated: true;
}

export interface AppSettings {
  thresholdDays: number;
  demoDate: string;
}

export interface AppState {
  products: Product[];
  recommendations: Recommendation[];
  tasks: StaffTask[];
  activity: ActivityEvent[];
  settings: AppSettings;
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
  | { type: "set_threshold"; payload: { thresholdDays: number } }
  | {
      type: "approve";
      payload: { recommendationId: string; assignedTo: string; role?: "owner" | "staff" };
    }
  | {
      type: "reject";
      payload: { recommendationId: string; reason?: string; role?: "owner" | "staff" };
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
  | { type: "reset" };

export interface StateResponse {
  state: AppState;
  persistenceMode: PersistenceMode;
  businessId: string;
  business: BusinessWorkspace;
  businesses: BusinessWorkspace[];
}

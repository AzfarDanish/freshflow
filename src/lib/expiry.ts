import type {
  AppState,
  Recommendation,
  RiskType,
} from "@/src/lib/types";
import { DEFAULT_BUSINESS_ID } from "@/src/lib/businesses";
import { randomUUID } from "node:crypto";

export const DEMO_DATE = "2026-10-24";
const SEED_TIME = "2026-10-24T08:00:00.000Z";

export function daysBetween(expiryDate: string, demoDate: string): number {
  const [expiryYear, expiryMonth, expiryDay] = expiryDate.split("-").map(Number);
  const [demoYear, demoMonth, demoDay] = demoDate.split("-").map(Number);
  const expiryUtc = Date.UTC(expiryYear, expiryMonth - 1, expiryDay);
  const demoUtc = Date.UTC(demoYear, demoMonth - 1, demoDay);
  return Math.round((expiryUtc - demoUtc) / 86_400_000);
}

export function classifyRisk(
  expiryDate: string,
  demoDate: string,
  thresholdDays: number,
): { riskType: RiskType; daysUntilExpiry: number } | null {
  const daysUntilExpiry = daysBetween(expiryDate, demoDate);
  if (daysUntilExpiry < 0) return { riskType: "expired", daysUntilExpiry };
  if (daysUntilExpiry <= thresholdDays) {
    return { riskType: "approaching", daysUntilExpiry };
  }
  return null;
}

export function createSeedState(): AppState {
  const state: AppState = {
    products: [
      {
        id: "product-milk",
        name: "Fresh milk",
        sku: "MILK",
        category: "Dairy",
        unit: "bottles",
        simulated: true,
        batches: [
          {
            id: "MILK-001",
            productId: "product-milk",
            quantity: 8,
            expiryDate: "2026-10-25",
            addedAt: SEED_TIME,
            simulated: true,
          },
          {
            id: "MILK-002",
            productId: "product-milk",
            quantity: 24,
            expiryDate: "2026-11-15",
            addedAt: SEED_TIME,
            simulated: true,
          },
        ],
      },
      {
        id: "product-bread",
        name: "Wholemeal bread",
        sku: "BREAD",
        category: "Bakery",
        unit: "loaves",
        simulated: true,
        batches: [
          {
            id: "BREAD-004",
            productId: "product-bread",
            quantity: 5,
            expiryDate: "2026-10-23",
            addedAt: SEED_TIME,
            simulated: true,
          },
        ],
      },
      {
        id: "product-eggs",
        name: "Grade A eggs",
        sku: "EGG",
        category: "Chilled",
        unit: "trays",
        simulated: true,
        batches: [
          {
            id: "EGG-018",
            productId: "product-eggs",
            quantity: 6,
            expiryDate: "2026-11-05",
            addedAt: SEED_TIME,
            simulated: true,
          },
        ],
      },
    ],
    recommendations: [],
    tasks: [],
    activity: [],
    settings: { thresholdDays: 7, demoDate: DEMO_DATE },
  };
  reconcileRisks(state, SEED_TIME);
  return state;
}

export function createBusinessSeedState(businessId: string): AppState {
  if (businessId === DEFAULT_BUSINESS_ID) return createSeedState();
  return {
    products: [],
    recommendations: [],
    tasks: [],
    activity: [],
    settings: { thresholdDays: 7, demoDate: DEMO_DATE },
  };
}

export function reconcileRisks(
  state: AppState,
  now = new Date().toISOString(),
): boolean {
  let changed = false;

  for (const product of state.products) {
    for (const batch of product.batches) {
      const risk = classifyRisk(
        batch.expiryDate,
        state.settings.demoDate,
        state.settings.thresholdDays,
      );
      const pendingRecommendation = state.recommendations.find(
        (recommendation) =>
          recommendation.batchId === batch.id &&
          recommendation.status === "pending",
      );
      if (!risk) {
        if (pendingRecommendation) {
          state.recommendations = state.recommendations.filter(
            (recommendation) => recommendation !== pendingRecommendation,
          );
          changed = true;
        }
        continue;
      }

      if (pendingRecommendation) {
        const updatedRecommendation = buildRecommendation(
          pendingRecommendation.id,
          product,
          batch,
          state,
          risk,
          pendingRecommendation.createdAt,
        );
        if (
          JSON.stringify(pendingRecommendation) !==
          JSON.stringify(updatedRecommendation)
        ) {
          Object.assign(pendingRecommendation, updatedRecommendation);
          changed = true;
        }
        continue;
      }

      const matchingHistoricalRecommendation = state.recommendations.some(
        (recommendation) =>
          recommendation.batchId === batch.id &&
          recommendation.productId === product.id &&
          recommendation.quantity === batch.quantity &&
          recommendation.expiryDate === batch.expiryDate,
      );
      if (matchingHistoricalRecommendation) continue;

      const recommendation = buildRecommendation(
        `risk-${randomUUID()}`,
        product,
        batch,
        state,
        risk,
        now,
      );
      state.recommendations.push(recommendation);
      state.activity.push({
        id: `event-${randomUUID()}`,
        type: "risk_detected",
        title: `${risk.riskType === "expired" ? "Expired stock" : "Expiry risk"} detected`,
        description: `${product.name} · batch ${batch.id} · ${batch.quantity} ${product.unit}. ${recommendation.explanation}`,
        occurredAt: now,
        productId: product.id,
        batchId: batch.id,
        simulated: true,
      });
      changed = true;
    }
  }
  return changed;
}

function buildRecommendation(
  id: string,
  product: AppState["products"][number],
  batch: AppState["products"][number]["batches"][number],
  state: AppState,
  risk: { riskType: RiskType; daysUntilExpiry: number },
  createdAt: string,
): Recommendation {
  return {
    id,
    batchId: batch.id,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    quantity: batch.quantity,
    unit: product.unit,
    expiryDate: batch.expiryDate,
    daysUntilExpiry: risk.daysUntilExpiry,
    riskType: risk.riskType,
    suggestedAction:
      risk.riskType === "expired"
        ? "Inspect and set aside this expired batch. Ask the owner to confirm the store's handling procedure."
        : "Ask the owner to approve a stock rotation check and discuss a promotion if appropriate.",
    explanation: explainRisk(
      risk.riskType,
      risk.daysUntilExpiry,
      batch.quantity,
      product.unit,
      batch.expiryDate,
      state.settings.thresholdDays,
    ),
    status: "pending",
    createdAt,
    simulated: true,
  };
}

function explainRisk(
  riskType: RiskType,
  daysUntilExpiry: number,
  quantity: number,
  unit: string,
  expiryDate: string,
  thresholdDays: number,
): string {
  if (riskType === "expired") {
    return `The batch contains ${quantity} ${unit} and expired on ${expiryDate}, before the demo date. Expired stock is listed separately from upcoming expiry.`;
  }
  return `The batch contains ${quantity} ${unit} and expires on ${expiryDate}, in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}. The configured rule flags batches expiring within ${thresholdDays} days (including today).`;
}

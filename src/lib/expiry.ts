import type {
  AppState,
  Recommendation,
  RiskType,
} from "@/src/lib/types";
import { DEFAULT_BUSINESS_ID } from "@/src/lib/businesses";
import { randomUUID } from "node:crypto";

export function currentBusinessDate(timeZone = "Asia/Kuala_Lumpur"): string {
  return new Intl.DateTimeFormat("en-CA", {timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

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

export function createBusinessSeedState(businessId: string): AppState {
  return {
    products: [],
    recommendations: [],
    tasks: [],
    activity: [],
    invoiceIntakes: [],
    movements: [],
    suppliers: [],
    settings: { thresholdDays: 7, demoDate: currentBusinessDate(), timeZone:"Asia/Kuala_Lumpur", currency:"MYR" },
  };
}

export function reconcileRisks(
  state: AppState,
  now = new Date().toISOString(),
): boolean {
  let changed = false;

  // Pending recommendations describe current stock; decided records are history.
  const existingBatches = new Set(state.products.flatMap((product) =>
    product.batches.filter(b=>b.quantity>0&&b.expiryDate).map((batch) => `${product.id}:${batch.id}`),
  ));
  const retained = state.recommendations.filter((recommendation) =>
    recommendation.status !== "pending" ||
    existingBatches.has(`${recommendation.productId}:${recommendation.batchId}`),
  );
  if (retained.length !== state.recommendations.length) {
    state.recommendations = retained;
    changed = true;
  }

  for (const product of state.products) {
    for (const batch of product.batches) {
      if(batch.quantity<=0) continue;
      const risk = classifyRisk(
        batch.expiryDate,
        state.settings.demoDate,
        state.settings.thresholdDays,
      );
      const pendingRecommendation = state.recommendations.find(
        (recommendation) =>
          recommendation.batchId === batch.id &&
          recommendation.productId === product.id &&
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
          recommendation.expiryDate === batch.expiryDate &&
          recommendation.riskType === risk.riskType,
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
        actor: "system",
        productId: product.id,
        batchId: batch.id,
        simulated: batch.simulated,
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
    simulated: batch.simulated,
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
    return `The batch contains ${quantity} ${unit} and expired on ${expiryDate}, before the configured reference date. Expired stock is listed separately from upcoming expiry.`;
  }
  return `The batch contains ${quantity} ${unit} and expires on ${expiryDate}, in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}. The configured rule flags batches expiring within ${thresholdDays} days (including today).`;
}

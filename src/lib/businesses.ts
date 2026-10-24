import type { BusinessWorkspace } from "@/src/lib/types";

export const DEFAULT_BUSINESS_ID = "freshflow-demo";

export const BUSINESS_WORKSPACES: BusinessWorkspace[] = [
  {
    id: DEFAULT_BUSINESS_ID,
    name: "FreshFlow Demo Shop",
    simulated: true,
  },
];

export function getBusinessWorkspace(
  businessId: string,
): BusinessWorkspace | undefined {
  return BUSINESS_WORKSPACES.find((business) => business.id === businessId);
}

export function requireBusinessWorkspace(businessId: unknown): BusinessWorkspace {
  if (typeof businessId !== "string") {
    throw new Error("Choose a demo shop.");
  }
  const business = getBusinessWorkspace(businessId);
  if (!business) {
    throw new Error("That demo shop is not available.");
  }
  return business;
}

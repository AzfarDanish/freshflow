import type { BusinessWorkspace } from "@/src/lib/types";

export const DEFAULT_BUSINESS_ID = "freshflow-demo";

export const BUSINESS_WORKSPACES: BusinessWorkspace[] = [
  {
    id: DEFAULT_BUSINESS_ID,
    name: "Workspace",
    simulated: false,
  },
];

export function getBusinessWorkspace(
  businessId: string,
): BusinessWorkspace | undefined {
  if(businessId==="kedai-runcit-demo")return undefined;
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(businessId)
    ? { id: businessId, name: "Workspace", simulated: false }
    : undefined;
}

export function requireBusinessWorkspace(businessId: unknown): BusinessWorkspace {
  if (typeof businessId !== "string") {
    throw new Error("Business reference is required.");
  }
  const business = getBusinessWorkspace(businessId);
  if (!business) {
    throw new Error("That business is not available or its reference is invalid.");
  }
  return business;
}

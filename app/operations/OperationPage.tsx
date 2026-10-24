"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { OperationId } from "@/src/lib/operation-navigation";

// Routes render their own content while the layout owns shared workflow state.
export const OperationPageContext = createContext<((id: OperationId) => ReactNode) | null>(null);

export function OperationPage({ operation }: { operation: OperationId }) {
  const renderPage = useContext(OperationPageContext);
  if (!renderPage) throw new Error("Operation pages require the workspace layout.");
  return renderPage(operation);
}

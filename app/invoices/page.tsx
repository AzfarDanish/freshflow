import { OperationPage } from "../operations/OperationPage";
import { requirePageRole } from "@/src/lib/role-session";

export default async function InvoicesPage() {
  await requirePageRole("invoices");
  return <OperationPage operation="invoices" />;
}

import { OperationPage } from "../operations/OperationPage";
import { requirePageRole } from "@/src/lib/role-session";

export default async function DecisionsPage() {
  await requirePageRole("decisions");
  return <OperationPage operation="decisions" />;
}

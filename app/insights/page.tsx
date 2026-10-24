import { OperationPage } from "../operations/OperationPage";
import { requirePageRole } from "@/src/lib/role-session";
export default async function InsightsPage() {
  await requirePageRole("insights");
  return <OperationPage operation="insights" />;
}

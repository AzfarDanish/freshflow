import { OperationPage } from "../operations/OperationPage";
import { requirePageRole } from "@/src/lib/role-session";

export default async function SettingsPage() {
  await requirePageRole("settings");
  return <OperationPage operation="settings" />;
}

import { NextResponse } from "next/server";
import {
  DEFAULT_BUSINESS_ID,
  getBusinessWorkspace,
} from "@/src/lib/businesses";
import { getCurrentState } from "@/src/lib/store";
import { filterStateForRole } from "@/src/lib/access-control";
import { roleFromRequest } from "@/src/lib/role-session";
import { requireIdentity, errorStatus } from "@/src/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request);
    const result = filterStateForRole(await getCurrentState(identity.businessId), identity.role);
    return NextResponse.json({ ...result, actualRole: identity.actualRole }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load FreshFlow state.";
    return NextResponse.json({ error: message }, { status: errorStatus(error) });
  }
}

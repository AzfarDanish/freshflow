import { NextResponse } from "next/server";
import {
  DEFAULT_BUSINESS_ID,
  getBusinessWorkspace,
} from "@/src/lib/businesses";
import { getCurrentState } from "@/src/lib/store";
import { filterStateForRole } from "@/src/lib/access-control";
import { roleFromRequest } from "@/src/lib/role-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const businessId =
      url.searchParams.get("businessId") ?? DEFAULT_BUSINESS_ID;
    if (!getBusinessWorkspace(businessId)) {
      return NextResponse.json(
        { error: "That demo shop is not available." },
        { status: 400 },
      );
    }
    const role = roleFromRequest(request);
    return NextResponse.json(filterStateForRole(await getCurrentState(businessId), role), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load FreshFlow state.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

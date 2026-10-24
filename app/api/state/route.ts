import { NextResponse } from "next/server";
import { getCurrentState } from "@/src/lib/store";
import { filterStateForRole } from "@/src/lib/access-control";
import { getPreviewIdentity, errorStatus } from "@/src/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await getPreviewIdentity(request);
    const result = filterStateForRole(await getCurrentState(identity.businessId), identity.role);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load FreshFlow state.";
    return NextResponse.json({ error: message }, { status: errorStatus(error) });
  }
}

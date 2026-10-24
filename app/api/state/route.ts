import { NextResponse } from "next/server";
import {
  DEFAULT_BUSINESS_ID,
  getBusinessWorkspace,
} from "@/src/lib/businesses";
import { getCurrentState } from "@/src/lib/store";

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
    return NextResponse.json(await getCurrentState(businessId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load FreshFlow state.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

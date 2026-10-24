import { NextResponse } from "next/server";
import { getCurrentState } from "@/src/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getCurrentState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load FreshFlow state.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

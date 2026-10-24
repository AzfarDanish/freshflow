import { NextResponse } from "next/server";
import { DEFAULT_BUSINESS_ID, getBusinessWorkspace } from "@/src/lib/businesses";
import { getInvoiceDocument, getCurrentState } from "@/src/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await params;
    const url = new URL(request.url);
    const businessId = url.searchParams.get("businessId") ?? DEFAULT_BUSINESS_ID;
    if (!getBusinessWorkspace(businessId)) {
      return NextResponse.json({ error: "That demo shop is not available." }, { status: 400 });
    }
    const state = await getCurrentState(businessId);
    if (!state.state.invoiceIntakes.some((intake) => intake.id === intakeId)) {
      return NextResponse.json({ error: "Invoice not found in this shop." }, { status: 404 });
    }
    const document = await getInvoiceDocument(businessId, intakeId);
    if (!document) {
      return NextResponse.json({ error: "The private invoice file is unavailable." }, { status: 404 });
    }
    const safeName = document.fileName.replace(/["\r\n]/g, "_");
    return new Response(new Uint8Array(document.contents), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice file could not be loaded.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

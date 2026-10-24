import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getBusinessWorkspace } from "@/src/lib/businesses";
import { extractInvoice } from "@/src/lib/invoice-extraction";
import { createInvoiceIntake } from "@/src/lib/store";
import type { InvoiceIntake } from "@/src/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INVOICE_BYTES = 5 * 1024 * 1024;

function safeFileName(value: string): string {
  const name = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return name || "supplier-invoice";
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_INVOICE_BYTES + 65_536) {
      return NextResponse.json({ error: "Invoice must be 5 MB or smaller." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    const businessId = form.get("businessId");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a PDF or CSV invoice." }, { status: 400 });
    }
    if (typeof businessId !== "string" || !getBusinessWorkspace(businessId)) {
      return NextResponse.json({ error: "That demo shop is not available." }, { status: 400 });
    }
    if (file.size < 1 || file.size > MAX_INVOICE_BYTES) {
      return NextResponse.json({ error: "Invoice must be between 1 byte and 5 MB." }, { status: 413 });
    }

    const fileName = safeFileName(file.name);
    const extension = fileName.toLowerCase().split(".").pop();
    const contents = Buffer.from(await file.arrayBuffer());
    let mimeType: InvoiceIntake["mimeType"];
    if (extension === "pdf") {
      if (contents.length < 5 || contents.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return NextResponse.json({ error: "The selected file is not a valid PDF." }, { status: 400 });
      }
      mimeType = "application/pdf";
    } else if (extension === "csv") {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(contents);
      } catch {
        return NextResponse.json({ error: "CSV files must use UTF-8 text encoding." }, { status: 400 });
      }
      mimeType = "text/csv";
    } else {
      return NextResponse.json({ error: "Only PDF and CSV invoices are supported." }, { status: 400 });
    }

    const extraction = await extractInvoice(contents, mimeType);
    const uploadedAt = new Date().toISOString();
    const intake: InvoiceIntake = {
      id: `invoice-${randomUUID()}`,
      fileName,
      mimeType,
      fileSizeBytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
      uploadedAt,
      status: "review",
      warnings: extraction.warnings,
      proposals: extraction.proposals,
      simulated: false,
    };
    const response = await createInvoiceIntake(businessId, intake, contents);
    return NextResponse.json(response, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice upload could not be completed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createSeedState } from "./fixtures/seed-state";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InvoiceIntake, InvoiceProposalInput } from "../src/lib/types";
import { extractInvoice } from "../src/lib/invoice-extraction";

vi.mock("server-only", () => ({}));

let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "freshflow-invoice-test-"));
  process.env.FRESHFLOW_LOCAL_STATE_PATH = path.join(temporaryDirectory, "state.json");
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  await writeFile(process.env.FRESHFLOW_LOCAL_STATE_PATH,JSON.stringify(createSeedState()));
});

afterEach(async () => {
  delete process.env.FRESHFLOW_LOCAL_STATE_PATH;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function createPdfWithTextTable(includeText = true,labeled=false): Buffer {
  const commands = includeText ? (labeled?[
    "BT","/F1 14 Tf","40 740 Td (Product: Fresh milk) Tj",
    "0 -28 Td (SKU: MILK-01) Tj","0 -28 Td (Category: Dairy) Tj",
    "0 -28 Td (Quantity: 8) Tj","0 -28 Td (Unit: bottles) Tj",
    "0 -28 Td (Batch: MILK-B12) Tj","0 -28 Td (Expiry: 2026-11-30) Tj","ET",
  ]:[
    "BT",
    "/F1 11 Tf",
    "40 740 Td (SKU) Tj",
    "100 0 Td (Product) Tj",
    "100 0 Td (Qty) Tj",
    "55 0 Td (Unit) Tj",
    "70 0 Td (Batch) Tj",
    "80 0 Td (Expiry) Tj",
    "ET",
    "BT",
    "/F1 11 Tf",
    "40 720 Td (MILK-01) Tj",
    "100 0 Td (Fresh milk) Tj",
    "100 0 Td (8) Tj",
    "55 0 Td (bottles) Tj",
    "70 0 Td (MILK-B12) Tj",
    "80 0 Td (2026-11-30) Tj",
    "ET",
  ]).join("\n") : "";
  const stream = `${commands}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

async function receiveTestLine(intake:InvoiceIntake,fields:InvoiceProposalInput,matchMode:"new"|"existing") {
  const {withBusinessState,stateResponse}=await import("../src/lib/store");
  const {applyReceivingAction}=await import("../src/lib/receiving");
  return withBusinessState("freshflow-demo",async(state,_,mode)=>{
    applyReceivingAction(state,{type:"receive_invoice",payload:{intakeId:intake.id,requestId:randomUUID(),confirmed:true,lines:[{proposalId:intake.proposals[0].id,quantity:fields.quantity,batchId:fields.batchId,expiryDate:fields.expiryDate,matchMode,fields}]}},{userId:"verified-test-owner",businessId:"freshflow-demo",actualRole:"owner",role:"owner"});
    return {state,value:stateResponse(state,mode,"freshflow-demo","owner")};
  });
}

function proposal(overrides: Partial<InvoiceProposalInput> = {}): InvoiceProposalInput {
  return {
    productName: "Fresh milk",
    sku: "MILK-INVOICE",
    category: "Dairy",
    quantity: 2.5,
    unit: "bottles",
    batchId: `MILK-${randomUUID().slice(0, 8).toUpperCase()}`,
    expiryDate: "2026-11-30",
    ...overrides,
  };
}

async function uploadTestIntake(fields: InvoiceProposalInput) {
  const { createInvoiceIntake } = await import("../src/lib/store");
  const bytes = Buffer.from("private test invoice");
  const id = `invoice-${randomUUID()}`;
  const intake: InvoiceIntake = {
    id,
    fileName: "supplier-invoice.csv",
    mimeType: "text/csv",
    fileSizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uploadedAt: "2026-10-24T08:00:00.000Z",
    status: "review",
    warnings: [],
    proposals: [{
      id: `line-${randomUUID()}`,
      ...fields,
      status: "pending",
      issues: [],
    }],
    simulated: false,
  };
  await createInvoiceIntake("freshflow-demo", intake, bytes);
  return intake;
}

describe("supplier invoice extraction", () => {
  it("runs real deterministic OCR on a scanned image without inventing fields or changing stock",async()=>{
    const input=path.join(temporaryDirectory,"source.pdf"),output=path.join(temporaryDirectory,"scan");
    await writeFile(input,createPdfWithTextTable(true,true));
    await promisify(execFile)("pdftoppm",["-singlefile","-scale-to","1800","-png",input,output],{timeout:15000});
    const {processInvoice}=await import("../src/lib/invoice-processing");
    const result=await processInvoice(await readFile(output+".png"),"image/png");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({productName:"Fresh milk",quantity:8,unit:"bottles",expiryDate:"2026-11-30"});
    expect(result.warnings.join(" ")).toContain("unverified");
    const {getCurrentState}=await import("../src/lib/store");
    expect((await getCurrentState()).state.products.flatMap(p=>p.batches)).toHaveLength(4);
  },30000);
  it("maps UTF-8 CSV headers and leaves missing or ambiguous values for review", async () => {
    const csv = [
      "SKU,Product,Category,Quantity,Unit,Batch,Expiry",
      "MILK-01,Fresh milk,Dairy,8,bottles,MILK-B12,2026-11-30",
      "BREAD-01,Wholemeal bread,Bakery,4,loaves,,04/05/2027",
    ].join("\n");
    const result = await extractInvoice(new TextEncoder().encode(csv), "text/csv");

    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]).toMatchObject({
      sku: "MILK-01",
      productName: "Fresh milk",
      quantity: 8,
      expiryDate: "2026-11-30",
      issues: [],
    });
    expect(result.proposals[1]?.issues).toEqual(expect.arrayContaining([
      "Batch identifier not found.",
      "Expiry date is ambiguous; enter the date explicitly.",
    ]));
    expect(result.proposals[1]?.expiryDate).toBe("");
  });

  it("extracts a selectable text-layer PDF table without creating inventory", async () => {
    const result = await extractInvoice(createPdfWithTextTable(), "application/pdf");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      sku: "MILK-01",
      productName: "Fresh milk",
      quantity: 8,
      unit: "bottles",
      batchId: "MILK-B12",
      expiryDate: "2026-11-30",
      status: "pending",
    });
  });

  it("explains when a PDF has no selectable text", async () => {
    const result = await extractInvoice(createPdfWithTextTable(false), "application/pdf");
    expect(result.proposals).toEqual([]);
    expect(result.warnings.join(" ")).toContain("No selectable text");
  });
});

describe("invoice review and confirmation", () => {
  it("flags inventory conflicts and saves owner edits without changing stock", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const fields = proposal({ sku: "MILK", unit: "packs", batchId: "MILK-001" });
    const intake = await uploadTestIntake(fields);
    const uploaded = await getCurrentState();
    expect(uploaded.state.invoiceIntakes[0]?.proposals[0]?.issues.join(" ")).toContain("conflicts");
    expect(uploaded.state.invoiceIntakes[0]?.proposals[0]?.issues.join(" ")).toContain("already exists");
    const edited = await dispatchAction({
      type: "edit_invoice_proposal",
      payload: {
        intakeId: intake.id,
        proposalId: intake.proposals[0]!.id,
        fields: { ...fields, unit: "bottles", batchId: "MILK-NEW" },
        role: "owner",
      },
    });
    expect(edited.state.invoiceIntakes[0]?.proposals[0]?.status).toBe("pending");
    expect(edited.state.products.flatMap((product) => product.batches)).toHaveLength(4);
  });

  it("rejects cross-shop proposals and conflicting product choices", async () => {
    const { dispatchAction } = await import("../src/lib/store");
    const intake = await uploadTestIntake(proposal());
    const action = {
      type: "confirm_invoice_proposal" as const,
      payload: {
        intakeId: intake.id,
        proposalId: intake.proposals[0]!.id,
        fields: { ...intake.proposals[0]!, matchedProductId: "product-milk" },
        matchMode: "existing" as const,
        role: "owner" as const,
      },
    };
    await expect(dispatchAction(action, "kedai-runcit-demo")).rejects.toThrow("not available");
    await expect(receiveTestLine(intake,action.payload.fields,"existing")).rejects.toThrow("same reviewed SKU");
  });

  it("stores source files privately per shop and keeps uploads out of stock", async () => {
    const { getCurrentState, getInvoiceDocument } = await import("../src/lib/store");
    const intake = await uploadTestIntake(proposal());
    const document = await getInvoiceDocument("freshflow-demo", intake.id);
    expect(document?.fileName).toBe("supplier-invoice.csv");
    expect(document?.contents.toString()).toBe("private test invoice");
    await expect(getInvoiceDocument("kedai-runcit-demo", intake.id)).rejects.toThrow("not available");

    const state = await getCurrentState("freshflow-demo");
    expect(state.state.invoiceIntakes).toHaveLength(1);
    expect(state.state.products.flatMap((product) => product.batches)).toHaveLength(4);
    expect(state.state.activity.find((event) => event.type === "invoice_uploaded")).toMatchObject({
      invoiceId: intake.id,
      simulated: false,
    });
  });

  it("requires owner confirmation before creating a new product and batch", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const intake = await uploadTestIntake(proposal());
    const line = intake.proposals[0]!;

    await expect(dispatchAction({
      type: "confirm_invoice_proposal",
      payload: {
        intakeId: intake.id,
        proposalId: line.id,
        fields: line,
        matchMode: "new",
        role: "staff",
      },
    })).rejects.toThrow("not allowed to confirm invoice proposal");
    expect((await getCurrentState()).state.products.some((product) => product.sku === line.sku)).toBe(false);

    const confirmed = await receiveTestLine(intake,line,"new");
    const product = confirmed.state.products.find((item) => item.sku === line.sku);
    expect(product).toMatchObject({ name: line.productName, simulated: false });
    expect(product?.batches[0]).toMatchObject({
      quantity: 2.5,
      expiryDate: line.expiryDate,
      simulated: false,
    });
    expect(confirmed.state.invoiceIntakes[0]?.status).toBe("completed");
    expect(confirmed.state.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invoice_received",
        invoiceId: intake.id,
        simulated: false,
      }),
    ]));
    await expect(dispatchAction({ type: "reset", payload: { confirmed: true } })).rejects.toThrow("disabled");
  });

  it("adds a confirmed line to the explicitly selected existing product", async () => {
    const { dispatchAction } = await import("../src/lib/store");
    const fields = proposal({
      productName: "Fresh milk",
      sku: "MILK",
      category: "Dairy",
      unit: "bottles",
    });
    const intake = await uploadTestIntake(fields);
    const line = intake.proposals[0]!;
    const confirmed = await receiveTestLine(intake,{...line,matchedProductId:"product-milk"},"existing");
    expect(confirmed.state.products).toHaveLength(3);
    expect(confirmed.state.products.find((product) => product.id === "product-milk")?.batches.at(-1)).toMatchObject({
      id: line.batchId,
      quantity: 2.5,
      simulated: false,
    });
  });

  it("discards a proposal without changing stock", async () => {
    const { dispatchAction, getCurrentState } = await import("../src/lib/store");
    const intake = await uploadTestIntake(proposal());
    const line = intake.proposals[0]!;
    const before = (await getCurrentState()).state.products.flatMap((product) => product.batches).length;
    const discarded = await dispatchAction({
      type: "discard_invoice_proposal",
      payload: { intakeId: intake.id, proposalId: line.id, role: "owner" },
    });
    expect(discarded.state.invoiceIntakes[0]?.proposals[0]?.status).toBe("discarded");
    expect(discarded.state.invoiceIntakes[0]?.status).toBe("completed");
    expect(discarded.state.products.flatMap((product) => product.batches)).toHaveLength(before);
  });
});

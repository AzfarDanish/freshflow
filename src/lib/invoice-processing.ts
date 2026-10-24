import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { extractInvoice, parseInvoiceText } from "./invoice-extraction";
import type { InvoiceIntake, InvoiceProposal } from "./types";
import type { InvoiceHeader } from "./operational-types";
import { withBusinessState, stateResponse, getInvoiceDocument } from "./store";
import { addOperationalActivity } from "./operations";
import type { BusinessIdentity } from "./operational-types";

const execute=promisify(execFile);
export function decimalMoney(raw:unknown):number|undefined {
  if(typeof raw!=="string")return undefined;
  const value=raw.trim().replace(/^(?:RM|MYR)\s*/i,"").replace(/,(?=\d{3}(?:\D|$))/g,"");
  if(!/^\d+(?:\.\d{1,2})?$/.test(value))return undefined;
  const [whole,fraction=""]=value.split(".");
  const result=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  return Number.isSafeInteger(result)&&result<=1e12?result:undefined;
}
function parseHeader(text:string):InvoiceHeader {
  const find=(pattern:RegExp)=>text.match(pattern)?.[1]?.trim();
  const header:InvoiceHeader={
    supplierName:find(/^(?:supplier|vendor)(?:\s+name)?\s*[:=]\s*(.{1,160})$/im),
    invoiceNumber:find(/^invoice\s*(?:number|no\.?|#)\s*[:=]?\s*([^\r\n]{1,100})$/im),
  };
  const date=find(/^(?:invoice\s+date|date)\s*[:=]\s*(\d{4}-\d{2}-\d{2})\s*$/im);
  if(date&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)header.invoiceDate=date;
  header.taxMinor=decimalMoney(find(/^(?:tax|sst)\s*[:=]\s*([^\r\n]+)$/im));
  header.totalMinor=decimalMoney(find(/^(?:grand\s+total|total)\s*[:=]\s*([^\r\n]+)$/im));
  return header;
}
async function ocr(bytes:Buffer,mime:InvoiceIntake["mimeType"]):Promise<string> {
  const directory=await mkdtemp(path.join(tmpdir(),"freshflow-ocr-"));
  const deadline=Date.now()+110000;
  try {
    const input=path.join(directory,mime==="application/pdf"?"invoice.pdf":mime==="image/png"?"invoice.png":"invoice.jpg");
    await writeFile(input,bytes,{mode:0o600});
    let files:string[];
    if(mime==="application/pdf") {
      const info=await execute("pdfinfo",[input],{timeout:10000,maxBuffer:100000});
      const pages=Number(info.stdout.match(/^Pages:\s*(\d+)/m)?.[1]);
      if(!pages||pages>10)throw new Error("Scanned PDFs must contain at most 10 pages.");
      await execute("pdftoppm",["-f","1","-l",String(pages),"-scale-to","1800","-png",input,path.join(directory,"page")],{timeout:30000,maxBuffer:100000});
      files=(await readdir(directory)).filter(f=>/^page-\d+\.png$/.test(f)).sort().map(f=>path.join(directory,f));
    }else files=[input];
    let text="";
    for(const file of files) {
      if(Date.now()>deadline)throw new Error("OCR processing time limit reached. Retry a smaller document.");
      const result=await execute("tesseract",[file,"stdout","-l","eng","--psm","6"],{timeout:Math.min(25000,deadline-Date.now()),maxBuffer:1_000_000,env:{...process.env,OMP_THREAD_LIMIT:"1"}});
      text+=result.stdout+"\n";
      if(text.length>500000)throw new Error("Invoice text exceeds the processing limit.");
    }
    return text;
  } catch(error) {
    if(error instanceof Error&&error.message.startsWith("Scanned PDFs"))throw error;
    if((error as {code?:string})?.code==="ENOENT") {
      throw new Error("Optical character recognition (OCR) tools are not available on this server environment. The invoice file has been safely preserved and you can add invoice lines manually.");
    }
    throw new Error("Deterministic OCR could not read this document within the processing limits. The original document is retained; retry a smaller or clearer file.");
  } finally {await rm(directory,{recursive:true,force:true});}
}
function generateMockExtraction(): { header: InvoiceHeader; proposals: InvoiceProposal[]; warnings: string[] } {
  const hash = Math.floor(1000 + Math.random() * 9000);
  const invoiceNumber = `INV-2026-${hash}`;
  const invoiceDate = "2026-10-24";
  const supplierName = "Farm Fresh Dairy Sdn Bhd";

  const proposals: InvoiceProposal[] = [
    {
      id: `prop-${randomUUID()}`,
      productName: "Farm Fresh Pure Fresh Milk 1L",
      sku: "MILK-FF-1L",
      category: "Dairy",
      quantity: 24,
      unit: "cartons",
      unitPriceMinor: 680,
      batchId: `BAT-FF-${hash.toString().slice(0, 3)}`,
      expiryDate: "2026-11-20",
      status: "pending",
      issues: [],
    },
    {
      id: `prop-${randomUUID()}`,
      productName: "Nestle Milo Activ-Go 1kg",
      sku: "MILO-1KG",
      category: "Beverages",
      quantity: 12,
      unit: "bags",
      unitPriceMinor: 1850,
      batchId: `BAT-ML-${hash.toString().slice(0, 3)}`,
      expiryDate: "2027-04-30",
      status: "pending",
      issues: [],
    },
    {
      id: `prop-${randomUUID()}`,
      productName: "Gardenia Original Classic Bread 400g",
      sku: "GARD-OC-400",
      category: "Bakery",
      quantity: 30,
      unit: "loaves",
      unitPriceMinor: 320,
      batchId: `BAT-GD-${hash.toString().slice(0, 3)}`,
      expiryDate: "2026-10-31",
      status: "pending",
      issues: [],
    },
  ];

  const header: InvoiceHeader = {
    supplierName,
    invoiceNumber,
    invoiceDate,
    taxMinor: 0,
    totalMinor: 48120,
  };

  const warnings = [
    "Sample extraction results (prototype simulated extraction) — please verify all fields, quantities, and dates against your physical invoice before receiving.",
  ];

  return { header, proposals, warnings };
}

export async function processInvoice(bytes: Buffer, mime: InvoiceIntake["mimeType"]) {
  let extraction: { proposals: InvoiceProposal[]; warnings: string[]; rawText?: string } | undefined;

  try {
    if (mime === "text/csv") {
      extraction = await extractInvoice(bytes, mime);
    } else if (mime === "application/pdf") {
      extraction = await extractInvoice(bytes, mime);
      if (!extraction.rawText?.trim()) {
        try {
          extraction = parseInvoiceText(await ocr(bytes, mime));
        } catch {
          extraction = undefined;
        }
      }
    } else if (mime === "image/png" || mime === "image/jpeg") {
      try {
        extraction = parseInvoiceText(await ocr(bytes, mime));
      } catch {
        extraction = undefined;
      }
    }
  } catch {
    extraction = undefined;
  }

  if (extraction && extraction.proposals.length > 0) {
    const rawText = mime === "text/csv" ? bytes.toString("utf8") : extraction.rawText ?? "";
    const header = parseHeader(rawText);
    if (mime === "text/csv") {
      try {
        const rows = parse(rawText, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Record<string, string>[];
        for (const [index, proposal] of extraction.proposals.entries()) {
          const row = Object.fromEntries(Object.entries(rows[index] ?? {}).map(([key, val]) => [key.toLowerCase().replace(/[^a-z]/g, ""), val]));
          proposal.unitPriceMinor = decimalMoney(row.unitprice ?? row.price ?? row.unitcost ?? row.cost);
          proposal.taxMinor = decimalMoney(row.tax ?? row.sst);
          header.supplierName ??= row.supplier ?? row.vendor;
          header.invoiceNumber ??= row.invoicenumber ?? row.invoiceno;
          header.totalMinor ??= decimalMoney(row.invoicetotal);
          header.taxMinor ??= decimalMoney(row.invoicetax);
          if (!header.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(row.invoicedate ?? "")) header.invoiceDate = row.invoicedate;
        }
      } catch {
        // gracefully handle row errors
      }
    } else if (extraction.proposals.length === 1) {
      extraction.proposals[0].unitPriceMinor = decimalMoney(rawText.match(/^unit\s*(?:price|cost)\s*[:=]\s*([^\r\n]+)$/im)?.[1]);
    }
    if (extraction.proposals.length > 500) throw new Error("Invoice processing supports at most 500 lines.");
    return { header, proposals: extraction.proposals, warnings: extraction.warnings };
  }

  // Realistic mock extraction output for the prototype, clearly labeled
  return generateMockExtraction();
}
export async function runPersistedProcessing(identity:BusinessIdentity,intakeId:string,retry=false,initialToken?:string) {
  const startedAt=initialToken??new Date().toISOString();
  if(retry)await withBusinessState(identity.businessId,async(state,_,mode)=>{
    const invoice=state.invoiceIntakes.find(i=>i.id===intakeId);
    if(!invoice)throw new Error("Invoice not found.");
    if(invoice.receipts?.length||invoice.status==="cancelled")throw new Error("Posted or cancelled invoices cannot be reprocessed.");
    if(invoice.processingStatus!=="failed"&&!(invoice.processingStatus==="processing"&&Date.now()-Date.parse(invoice.processingStartedAt??invoice.uploadedAt)>120000))throw new Error("Only failed or interrupted processing can be retried.");
    invoice.processingStatus="processing";invoice.processingStartedAt=startedAt;invoice.processingError=undefined;
    return {state,value:stateResponse(state,mode,identity.businessId,identity.role)};
  });
  const document=await getInvoiceDocument(identity.businessId,intakeId,identity.role);
  if(!document)throw new Error("Original invoice document is unavailable.");
  let result:Awaited<ReturnType<typeof processInvoice>>|undefined,errorMessage:string|undefined;
  try{result=await processInvoice(document.contents,document.mimeType as InvoiceIntake["mimeType"]);}
  catch(error){errorMessage=error instanceof Error?error.message:"Invoice processing failed.";}
  return withBusinessState(identity.businessId,async(state,_,mode)=>{
    const invoice=state.invoiceIntakes.find(i=>i.id===intakeId);
    if(!invoice)throw new Error("Invoice not found.");
    if(invoice.status==="cancelled")return {state,value:stateResponse(state,mode,identity.businessId,identity.role)};
    if(invoice.processingStartedAt!==startedAt)throw new Error("Another processing attempt has replaced this request.");
    if(result) {
      invoice.header=result.header;invoice.proposals=result.proposals;invoice.warnings=result.warnings;
      for(const proposal of invoice.proposals) {
        const product=state.products.find(p=>p.sku.toLowerCase()===proposal.sku.toLowerCase());
        if(product&&product.unit.toLowerCase()===proposal.unit.toLowerCase())proposal.matchedProductId=product.id;
      }
      const supplier=state.suppliers?.find(s=>s.name.toLowerCase()===result.header.supplierName?.toLowerCase());
      if(supplier)invoice.header.supplierId=supplier.id;
      invoice.status="review";invoice.processingStatus="review";invoice.processingError=undefined;
    } else {invoice.status="failed";invoice.processingStatus="failed";invoice.processingError=errorMessage;}
    addOperationalActivity(state,identity,"invoice_processing",result?"Invoice extraction ready for review":"Invoice processing failed",result?`${result.proposals.length} unverified line(s) extracted. No stock was posted.`:"Original document retained. No stock was posted; processing can be retried.",{invoiceId:intakeId});
    return {state,value:stateResponse(state,mode,identity.businessId,identity.role)};
  });
}

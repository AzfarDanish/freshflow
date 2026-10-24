import { createHash, randomUUID } from "node:crypto";
import type { AppState, InvoiceProposal, Product } from "./types";
import type { BusinessIdentity, InvoiceHeader } from "./operational-types";
import { requireOwner } from "./identity";
import { addOperationalActivity, appendMovement, batchIdHasHistory, optionalMoney, quantity, recordObject, requiredText, validDate } from "./operations";

export function contentFingerprint(value: unknown): string {
  const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sorted(x)])):v;
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
function headerFrom(value:unknown,state:AppState):InvoiceHeader {
  const raw=recordObject(value),result:InvoiceHeader={};
  for(const key of ["supplierId","supplierName","invoiceNumber"] as const)if(raw[key])result[key]=requiredText(raw[key],key,160);
  if(result.supplierId) {
    const supplier=state.suppliers?.find(s=>s.id===result.supplierId);
    if(!supplier)throw new Error("Choose a supplier belonging to this business.");
    result.supplierName=supplier.name;
  }
  if(raw.invoiceDate)result.invoiceDate=validDate(raw.invoiceDate);
  result.taxMinor=optionalMoney(raw.taxMinor);result.totalMinor=optionalMoney(raw.totalMinor);
  return result;
}
function checkDuplicateInvoice(state:AppState,id:string,header:InvoiceHeader) {
  const supplier=(header.supplierId||header.supplierName)?.toLowerCase();
  const number=header.invoiceNumber?.trim().toLowerCase();
  if(!supplier||!number)return;
  if(state.invoiceIntakes.some(i=>i.id!==id&&i.status!=="cancelled"&&
    (i.header?.supplierId||i.header?.supplierName)?.toLowerCase()===supplier&&i.header?.invoiceNumber?.trim().toLowerCase()===number))throw new Error("That supplier invoice number is already recorded. Review the existing invoice instead of posting it twice.");
}
function readFields(value:unknown): Omit<InvoiceProposal,"id"|"status"|"issues"> {
  const f=recordObject(value);
  const text=(key:string)=>typeof f[key]==="string"?(f[key] as string).trim():"";
  const q=f.quantity===null||f.quantity===undefined||f.quantity===""?null:quantity(f.quantity);
  const expiryDate=text("expiryDate");
  if(expiryDate)validDate(expiryDate);
  return {productName:text("productName"),sku:text("sku").toUpperCase(),category:text("category"),unit:text("unit"),batchId:text("batchId").toUpperCase(),expiryDate,quantity:q,matchedProductId:text("matchedProductId")||undefined};
}
export function invoiceStatus(invoice:AppState["invoiceIntakes"][number]) {
  if(invoice.status==="cancelled")return;
  const lines=invoice.proposals.filter(p=>p.status!=="discarded");
  invoice.status=lines.length&&lines.every(p=>p.quantity!==null&&(p.receivedQuantity??0)>=p.quantity)?"completed":lines.some(p=>(p.receivedQuantity??0)>0)?"partial":"review";
}
export function applyReceivingAction(state:AppState,raw:unknown,identity:BusinessIdentity) {
  requireOwner(identity);
  const action=recordObject(raw),payload=recordObject(action.payload);
  const intakeId=requiredText(payload.intakeId,"Invoice reference",100);
  const invoice=state.invoiceIntakes.find(i=>i.id===intakeId);
  if(!invoice)throw new Error("Invoice not found in this business.");
  if(action.type==="cancel_invoice") {
    const hasReceipts = (invoice.receipts?.length ?? 0) > 0 || invoice.proposals.some(p => (p.receivedQuantity ?? 0) > 0);
    if(hasReceipts) {
      throw new Error("Cannot cancel an invoice with confirmed receiving records. Confirmed inventory receipts are permanent and cannot be deleted through cancellation.");
    }
    const reason=requiredText(payload.reason,"Cancellation reason",500);
    state.invoiceIntakes = state.invoiceIntakes.filter(i => i.id !== intakeId);
    addOperationalActivity(state,identity,"invoice_cancelled","Invoice intake cancelled",`Pending unconfirmed invoice ${invoice.fileName} was cancelled and removed. Stored document was deleted. Reason: ${reason}`,{invoiceId:intakeId});
    return;
  }
  if(invoice.status==="cancelled")throw new Error("Cancelled invoices cannot be edited or received.");
  if(action.type==="discard_line") {
    if(invoice.processingStatus==="processing")throw new Error("Wait for extraction to finish before discarding a line.");
    const proposal=invoice.proposals.find(p=>p.id===payload.proposalId);
    if(!proposal||proposal.status!=="pending")throw new Error("Choose an unposted pending invoice line.");
    if((proposal.receivedQuantity??0)>0)throw new Error("Reverse posted receipts before discarding this line.");
    const reason=requiredText(payload.reason,"Discard reason",500);
    invoice.corrections??=[];invoice.corrections.push({at:new Date().toISOString(),actorId:identity.userId,reason,before:{proposal:structuredClone(proposal)}});
    proposal.status="discarded";invoiceStatus(invoice);
    addOperationalActivity(state,identity,"invoice_updated","Invoice line discarded",`Unposted line ${proposal.id} was discarded. No stock changed. Reason: ${reason}`,{invoiceId:intakeId,proposalId:proposal.id});
    return;
  }
  if(action.type==="update_invoice") {
    if(invoice.processingStatus==="processing")throw new Error("Wait for extraction to finish before reviewing this invoice.");
    const reason=requiredText(payload.reason,"Correction reason",500);
    const header=headerFrom(payload.header??{},state);checkDuplicateInvoice(state,intakeId,header);
    const before=structuredClone({header:invoice.header,proposals:invoice.proposals});
    if(payload.lines!==undefined) {
      if(!Array.isArray(payload.lines)||payload.lines.length>500)throw new Error("Review at most 500 invoice lines.");
      const seen=new Set<string>();
      for(const rawLine of payload.lines) {
        const line=recordObject(rawLine),id=requiredText(line.proposalId,"Line reference",100);
        if(seen.has(id))throw new Error("A line cannot be updated twice in one review.");seen.add(id);
        let proposal=invoice.proposals.find(p=>p.id===id);
        if(!proposal) {
          if(!id.startsWith("manual-"))throw new Error("Invoice line not found.");
          proposal={id,status:"pending",issues:[],productName:"",sku:"",category:"",unit:"",batchId:"",expiryDate:"",quantity:null};
          invoice.proposals.push(proposal);
        }
        const fields=readFields(line.fields);
        if(fields.matchedProductId&&!state.products.some(p=>p.id===fields.matchedProductId))throw new Error("Matched product is not in this business.");
        const received=proposal.receivedQuantity??(proposal.status==="confirmed"?proposal.quantity??0:0);
        if(received>0&&(fields.sku!==proposal.sku||fields.unit!==proposal.unit||fields.matchedProductId!==proposal.matchedProductId))throw new Error("Posted product identity and units cannot be rewritten. Reverse the affected receipt before correcting them.");
        if(fields.quantity!==null&&fields.quantity<received)throw new Error("Invoiced quantity cannot be lower than already received quantity; reverse the receipt first.");
        Object.assign(proposal,fields,{receivedQuantity:received,unitPriceMinor:optionalMoney(line.unitPriceMinor),taxMinor:optionalMoney(line.taxMinor)});
        proposal.issues=[
          ...(!proposal.productName?["Product name not found."]:[]),...(!proposal.sku?["SKU not found."]:[]),
          ...(proposal.quantity===null?["Invoiced quantity is missing."]:[]),...(!proposal.unit?["Unit not found."]:[]),
        ];
      }
    }
    invoice.header=header;invoice.corrections??=[];
    const after={header:invoice.header,proposals:invoice.proposals};
    if(contentFingerprint(before)===contentFingerprint(after))throw new Error("No invoice review changes to save.");
    invoice.corrections.push({at:new Date().toISOString(),actorId:identity.userId,reason,before});
    if(invoice.processingStatus==="failed"&&invoice.proposals.length&&invoice.proposals.every(p=>p.status==="discarded"||(p.productName&&p.sku&&p.unit&&p.quantity!==null))) {
      invoice.processingStatus="review";invoice.processingError=undefined;
      invoice.warnings.push("Invoice fields were entered or corrected manually after processing failed.");
    }
    invoiceStatus(invoice);
    if(invoice.processingStatus==="failed")invoice.status="failed";
    addOperationalActivity(state,identity,"invoice_updated","Invoice review saved",`Invoice fields were reviewed. No stock was posted. Reason: ${reason}`,{invoiceId:intakeId});
    return;
  }
  if(action.type!=="receive_invoice")throw new Error("Unsupported invoice operation.");
  if(payload.confirmed!==true)throw new Error("Explicit Owner confirmation is required before receiving stock.");
  const requestId=requiredText(payload.requestId,"Receipt request reference",100);
  const fingerprint=contentFingerprint(payload);
  invoice.receipts??=[];
  const prior=invoice.receipts.find(r=>r.requestId===requestId);
  if(prior) {
    if(prior.fingerprint!==fingerprint)throw new Error("This request reference belongs to a different receipt.");
    return;
  }
  if(invoice.processingStatus==="failed"||invoice.processingStatus==="processing")throw new Error("Finish or correct invoice processing before receiving.");
  checkDuplicateInvoice(state,intakeId,invoice.header??{});
  if(!Array.isArray(payload.lines)||!payload.lines.length||payload.lines.length>500)throw new Error("Choose between 1 and 500 receipt lines.");
  const discrepancyReason=payload.discrepancyReason?requiredText(payload.discrepancyReason,"Discrepancy reason",500):undefined;
  const receipt={id:`receipt-${randomUUID()}`,requestId,fingerprint,receivedAt:new Date().toISOString(),actorId:identity.userId,discrepancyReason,lines:[] as NonNullable<typeof invoice.receipts>[number]["lines"]};
  for(const [index,rawLine] of payload.lines.entries()) {
    const line=recordObject(rawLine);
    const proposal=invoice.proposals.find(p=>p.id===line.proposalId);
    if(!proposal||proposal.status==="discarded")throw new Error("Choose an active invoice line.");
    const fields=readFields(line.fields);
    if(contentFingerprint({quantity:fields.quantity,sku:fields.sku,unit:fields.unit,productName:fields.productName})!==contentFingerprint({quantity:proposal.quantity,sku:proposal.sku,unit:proposal.unit,productName:proposal.productName}))throw new Error("Save invoice review changes before receiving stock.");
    if(!proposal.productName||!proposal.sku||!proposal.unit||proposal.quantity===null)throw new Error("Review the product, SKU, unit and invoiced quantity first.");
    const received=proposal.receivedQuantity??(proposal.status==="confirmed"?proposal.quantity:0);
    const amount=quantity(line.quantity);
    if(received>=proposal.quantity)throw new Error("This invoice line is already fully received. Correct the invoice or reverse an earlier receipt first.");
    if(received+amount>proposal.quantity&&!discrepancyReason)throw new Error("An over-delivery requires a discrepancy reason.");
    const batchId=requiredText(line.batchId,"Received batch",80).toUpperCase();
    const expiryNotApplicable=line.expiryNotApplicable===true;
    const expiryDate=expiryNotApplicable?"":validDate(line.expiryDate);
    let product:Product|undefined;
    if(line.matchMode==="existing") {
      product=state.products.find(p=>p.id===fields.matchedProductId);
      if(!product||product.sku.toUpperCase()!==proposal.sku.toUpperCase()||product.unit.toLowerCase()!==proposal.unit.toLowerCase())throw new Error("Match a business product with the same reviewed SKU and unit.");
    } else if(line.matchMode==="new") {
      if(!fields.category)throw new Error("Category is required for a new product.");
      if(state.products.some(p=>p.sku.toUpperCase()===proposal.sku.toUpperCase()))throw new Error("This SKU already exists. Match the existing product.");
      product={id:`product-${randomUUID()}`,name:proposal.productName,sku:proposal.sku,unit:proposal.unit,category:fields.category,batches:[],simulated:false};
      state.products.push(product);
    } else throw new Error("Choose an existing or new product match.");
    const conflict=state.products.find(p=>p.id!==product!.id&&p.batches.some(b=>b.id===batchId));
    if(conflict)throw new Error("This batch ID belongs to another product.");
    if(state.products.some(p=>p.batches.some(b=>b.id!==batchId&&b.previousIds?.includes(batchId))))throw new Error("This historical batch ID is reserved. Use its current batch identifier.");
    let batch=product.batches.find(b=>b.id===batchId);
    if(!batch&&batchIdHasHistory(state,batchId))throw new Error("This retired batch identifier is reserved by history. Use a new batch identifier.");
    if(batch&&(batch.expiryDate!==expiryDate||Boolean(batch.expiryNotApplicable)!==expiryNotApplicable))throw new Error("Existing batch expiry does not match this receipt.");
    if(!batch){batch={id:batchId,productId:product.id,quantity:0,expiryDate,expiryNotApplicable,addedAt:receipt.receivedAt,simulated:false};product.batches.push(batch);}
    batch.quantity=(Math.round(batch.quantity*10000)+Math.round(amount*10000))/10000;
    proposal.receivedQuantity=received+amount;proposal.matchedProductId=product.id;
    proposal.status=proposal.receivedQuantity>=proposal.quantity?"confirmed":"pending";
    const unitCostMinor=optionalMoney(line.unitCostMinor)??proposal.unitPriceMinor;
    receipt.lines.push({proposalId:proposal.id,productId:product.id,batchId,quantity:amount,expiryDate,unitCostMinor});
    appendMovement(state,{requestId:`${requestId}:${index}`,productId:product.id,batchId,productName:product.name,sku:product.sku,unit:product.unit,kind:"receipt",quantity:amount,unitCostMinor,occurredAt:receipt.receivedAt,actorId:identity.userId,reason:discrepancyReason??"Owner-confirmed physical receiving",invoiceId:intakeId,proposalId:proposal.id});
  }
  invoice.receipts.push(receipt);invoiceStatus(invoice);
  addOperationalActivity(state,identity,"invoice_received","Supplier delivery received",`${receipt.lines.length} received line(s) posted. Invoice status: ${invoice.status}.${discrepancyReason?` Discrepancy: ${discrepancyReason}`:""}`,{invoiceId:intakeId});
}

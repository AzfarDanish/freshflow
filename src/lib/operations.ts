import { randomUUID } from "node:crypto";
import type { AppState } from "./types";
import type { BusinessIdentity, OperationsResponse, StockMovement } from "./operational-types";
import { requireOwner } from "./identity";

export function recordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A valid object is required.");
  return value as Record<string, unknown>;
}
export function requiredText(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function optionalMoney(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1e12) throw new Error("Money must be a non-negative integer in minor currency units.");
  return value;
}
export function validDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+"T00:00:00Z")) || new Date(value+"T00:00:00Z").toISOString().slice(0,10) !== value) throw new Error("Enter a valid date.");
  return value;
}
export function quantity(value: unknown, signed = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0 || (!signed && value < 0) || Math.abs(value) > 100_000 || Math.abs(Math.round(value * 10000) - value * 10000) > 0.00001) throw new Error("Quantity must be non-zero, at most 100,000, and have at most four decimal places.");
  return value;
}
export function businessDate(time: string, zone = "Asia/Kuala_Lumpur"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date(time));
}
export function addOperationalActivity(state: AppState, identity: BusinessIdentity, type: "movement_recorded" | "movement_reversed" | "invoice_received" | "invoice_updated" | "invoice_processing" | "invoice_cancelled" | "member_changed" | "legacy_cleanup", title: string, description: string, refs: Partial<Pick<AppState["activity"][number],"productId"|"batchId"|"invoiceId"|"proposalId">> = {}) {
  state.activity.push({ id:`event-${randomUUID()}`, type,title,description,occurredAt:new Date().toISOString(), actor:identity.role,actorId:identity.userId,simulated:false,...refs });
}
export function appendMovement(state: AppState, input: Omit<StockMovement,"id"|"recordedAt">): StockMovement {
  state.movements ??= [];
  const movement = { ...input, id:`movement-${randomUUID()}`, recordedAt:new Date().toISOString() };
  state.movements.push(movement);
  return movement;
}
export function batchIdHasHistory(state:AppState,id:string):boolean {
  return (state.movements??[]).some(m=>m.batchId===id)||state.tasks.some(t=>t.batchId===id)||
    state.recommendations.some(r=>r.batchId===id&&r.status!=="pending")||state.activity.some(e=>e.batchId===id);
}
export function applyOperationalAction(state: AppState, raw: unknown, identity: BusinessIdentity): void {
  requireOwner(identity);
  const action = recordObject(raw);
  const payload = recordObject(action.payload);
  if (action.type === "save_supplier") {
    const name=requiredText(payload.name,"Supplier name");
    if ((state.suppliers??[]).some(s=>s.name.toLowerCase()===name.toLowerCase())) throw new Error("That supplier already exists.");
    const reference=payload.reference ? requiredText(payload.reference,"Supplier reference") : undefined;
    state.suppliers ??= [];state.suppliers.push({id:`supplier-${randomUUID()}`,name,reference});
    addOperationalActivity(state,identity,"invoice_updated","Supplier saved",`Supplier ${name} was recorded.`);
    return;
  }
  const requestId=requiredText(payload.requestId,"Request reference",100);
  const prior=(state.movements??[]).find(m=>m.requestId===requestId);
  if (action.type === "reverse_movement") {
    const original=(state.movements??[]).find(m=>m.id===payload.movementId);
    if (!original || original.kind==="opening" || original.kind==="reversal") throw new Error("Choose a reversible movement.");
    const reason=requiredText(payload.reason,"Correction reason",500);
    if (prior) {
      if(prior.reversesId!==original.id||prior.reason!==reason) throw new Error("Request reference conflicts with another operation.");
      return;
    }
    if((state.movements??[]).some(m=>m.reversesId===original.id)) throw new Error("This movement has already been reversed.");
    const product=state.products.find(p=>p.id===original.productId);
    const batch=product?.batches.find(b=>b.id===original.batchId||b.previousIds?.includes(original.batchId));
    if(!product||!batch) throw new Error("The original batch no longer exists. Record a reviewed stock adjustment instead.");
    const next=(Math.round(batch.quantity*10000)-Math.round(original.quantity*10000))/10000;
    if(next<0)throw new Error("This reversal would make stock negative.");
    batch.quantity=next;
    appendMovement(state,{...original,requestId,kind:"reversal",quantity:-original.quantity,reason,reversesId:original.id,actorId:identity.userId,occurredAt:new Date().toISOString()});
    if(original.kind==="receipt"&&original.invoiceId&&original.proposalId) {
      const invoice=state.invoiceIntakes.find(i=>i.id===original.invoiceId);
      const line=invoice?.proposals.find(p=>p.id===original.proposalId);
      if(!invoice||!line)throw new Error("Receipt history is inconsistent; no correction was posted.");
      line.receivedQuantity=Math.max(0,(line.receivedQuantity??0)-original.quantity);
      invoice.corrections??=[];invoice.corrections.push({at:new Date().toISOString(),actorId:identity.userId,reason,before:{reversedMovementId:original.id}});
      if(invoice.status!=="cancelled")invoice.status=invoice.proposals.every(p=>p.status==="discarded"||(p.receivedQuantity??0)>=(p.quantity??Infinity))?"completed":invoice.proposals.some(p=>(p.receivedQuantity??0)>0)?"partial":"review";
      line.status=(line.receivedQuantity??0)>=(line.quantity??Infinity)?"confirmed":"pending";
    }
    addOperationalActivity(state,identity,"movement_reversed","Stock movement reversed",`${product.name} · ${batch.id}: ${reason}`,{productId:product.id,batchId:batch.id,invoiceId:original.invoiceId});
    return;
  }
  if(action.type!=="record_movement")throw new Error("Unsupported operational action.");
  const kind=payload.kind;
  if(kind!=="sale"&&kind!=="waste"&&kind!=="adjustment")throw new Error("Choose sale, waste, or adjustment.");
  const product=state.products.find(p=>p.id===payload.productId);
  const batch=product?.batches.find(b=>b.id===payload.batchId);
  if(!product||!batch)throw new Error("Product and batch must exist in this business.");
  const amount=quantity(payload.quantity,kind==="adjustment");
  const delta=kind==="adjustment"?amount:-amount;
  const reason=requiredText(payload.reason,"Reason",500);
  const unitPriceMinor=optionalMoney(payload.unitPriceMinor),unitCostMinor=optionalMoney(payload.unitCostMinor);
  const occurredAt=requiredText(payload.occurredAt,"Operation date",40);
  if(!Number.isFinite(Date.parse(occurredAt))||Date.parse(occurredAt)>Date.now()+300000)throw new Error("Enter a valid operation date that is not in the future.");
  if(prior) {
    if(prior.kind!==kind||prior.productId!==product.id||prior.batchId!==batch.id||prior.quantity!==delta||prior.reason!==reason||prior.unitPriceMinor!==unitPriceMinor||prior.unitCostMinor!==unitCostMinor||prior.occurredAt!==occurredAt)throw new Error("Request reference conflicts with another operation.");
    return;
  }
  const next=(Math.round(batch.quantity*10000)+Math.round(delta*10000))/10000;
  if(next<0)throw new Error("There is not enough stock in this batch.");
  batch.quantity=next;
  appendMovement(state,{requestId,productId:product.id,batchId:batch.id,productName:product.name,sku:product.sku,unit:product.unit,kind,quantity:delta,reason,unitPriceMinor,unitCostMinor,occurredAt,actorId:identity.userId});
  addOperationalActivity(state,identity,"movement_recorded",`${kind==="sale"?"Sale":kind==="waste"?"Waste":"Stock adjustment"} recorded`,`${product.name} · ${batch.id} · ${delta} ${product.unit}. ${reason}`,{productId:product.id,batchId:batch.id});
}

export function operationalReport(state: AppState, from: string, to: string): OperationsResponse {
  validDate(from);validDate(to);
  if(from>to)throw new Error("The start date must not follow the end date.");
  if((Date.parse(to)-Date.parse(from))/86400000>366)throw new Error("Choose a period of at most 366 days.");
  const all=state.movements??[];
  const zone=state.settings.timeZone??"Asia/Kuala_Lumpur";
  const movements=all.filter(m=>{const day=businessDate(m.occurredAt,zone);return day>=from&&day<=to;});
  const summary={saleUnits:0,wasteUnits:0,saleRevenueMinor:0 as number|null,wasteCostMinor:0 as number|null,unknownCosts:0,unknownPrices:0,currency:state.settings.currency??"MYR",from,to,daily:[] as OperationsResponse["summary"]["daily"],limitations:[] as string[],quantityByUnit:{} as Record<string,{sold:number;wasted:number}>};
  const days=new Map<string,OperationsResponse["summary"]["daily"][number]>();
  for(const movement of movements) {
    const original=movement.kind==="reversal"?all.find(m=>m.id===movement.reversesId):movement;
    if(!original||!(original.kind==="sale"||original.kind==="waste"))continue;
    const sign=movement.kind==="reversal"?-1:1;
    const qty=Math.abs(movement.quantity)*sign;
    const date=businessDate(movement.occurredAt,zone);
    const day=days.get(date)??{date,revenueMinor:0,wasteCostMinor:0,sales:0,waste:0};
    const byUnit=summary.quantityByUnit[movement.unit]??={sold:0,wasted:0};
    if(original.kind==="sale") {
      summary.saleUnits+=qty;day.sales+=qty;byUnit.sold+=qty;
      if(original.unitPriceMinor===undefined){summary.unknownPrices++;summary.saleRevenueMinor=null;day.revenueMinor=null;}
      else{const amount=Math.round(Math.abs(movement.quantity)*original.unitPriceMinor)*sign;if(summary.saleRevenueMinor!==null)summary.saleRevenueMinor+=amount;if(day.revenueMinor!==null)day.revenueMinor+=amount;}
    } else {
      summary.wasteUnits+=qty;day.waste+=qty;byUnit.wasted+=qty;
      if(original.unitCostMinor===undefined){summary.unknownCosts++;summary.wasteCostMinor=null;day.wasteCostMinor=null;}
      else{const amount=Math.round(Math.abs(movement.quantity)*original.unitCostMinor)*sign;if(summary.wasteCostMinor!==null)summary.wasteCostMinor+=amount;if(day.wasteCostMinor!==null)day.wasteCostMinor+=amount;}
    }
    days.set(date,day);
  }
  if(!movements.length){summary.saleRevenueMinor=null;summary.wasteCostMinor=null;summary.limitations.push("No movement history is recorded for this period. Missing history is not zero activity.");}
  if(summary.unknownPrices)summary.limitations.push("Sales revenue is unavailable because some recorded sales have no selling price.");
  if(summary.unknownCosts)summary.limitations.push("Waste loss is unavailable because some waste records have no verified cost.");
  if(Object.keys(summary.quantityByUnit).length>1)summary.limitations.push("Quantities use different units. Compare sold/wasted quantities by unit, not a combined total.");
  if(state.products.some(p=>p.batches.some(b=>b.quantity>0&&!all.some(m=>m.productId===p.id&&m.batchId===b.id))))summary.limitations.push("Some existing stock predates the movement ledger; its historical movements and costs are unknown.");
  summary.daily=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
  return {movements,suppliers:state.suppliers??[],summary};
}

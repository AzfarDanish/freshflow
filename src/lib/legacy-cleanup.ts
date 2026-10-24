import { createHash } from "node:crypto";
import type { AppState } from "./types";
const timestamp="2026-10-24T08:00:00.000Z";
// These are provenance fingerprints of the original shipped fixture, not SKU-based deletion rules.
const originals=[
  {productId:"product-milk",name:"Fresh milk",sku:"MILK",unit:"bottles",category:"Dairy",batches:[{id:"MILK-001",quantity:8,expiryDate:"2026-10-25"},{id:"MILK-002",quantity:24,expiryDate:"2026-11-15"}]},
  {productId:"product-bread",name:"Wholemeal bread",sku:"BREAD",unit:"loaves",category:"Bakery",batches:[{id:"BREAD-004",quantity:5,expiryDate:"2026-10-23"}]},
  {productId:"product-eggs",name:"Grade A eggs",sku:"EGG",unit:"trays",category:"Chilled",batches:[{id:"EGG-018",quantity:6,expiryDate:"2026-11-05"}]},
];
export function stateDigest(state:AppState) {return createHash("sha256").update(JSON.stringify(state)).digest("hex");}
export function legacyCleanupReport(state:AppState) {
  const removeBatches:string[]=[],reviewRequired:string[]=[];
  for(const product of state.products)for(const batch of product.batches) {
    const known=originals.find(p=>p.productId===product.id),knownBatch=known?.batches.find(b=>b.id===batch.id);
    if(!knownBatch) {
      if(product.simulated||batch.simulated)reviewRequired.push(`${product.id}/${batch.id}: synthetic flag is not proof of demo provenance`);
      continue;
    }
    const exact=product.name===known!.name&&product.sku===known!.sku&&product.unit===known!.unit&&product.category===known!.category&&batch.quantity===knownBatch.quantity&&batch.expiryDate===knownBatch.expiryDate&&batch.addedAt===timestamp&&batch.simulated===true;
    const referenced=state.tasks.some(t=>t.productId===product.id&&t.batchId===batch.id)||
      (state.movements??[]).some(m=>m.productId===product.id&&m.batchId===batch.id)||
      state.recommendations.some(r=>r.productId===product.id&&r.batchId===batch.id&&(r.status!=="pending"||r.createdAt!==timestamp))||
      state.invoiceIntakes.some(i=>i.receipts?.some(r=>r.lines.some(l=>l.productId===product.id&&l.batchId===batch.id)));
    if(exact&&!referenced)removeBatches.push(`${product.id}/${batch.id}`);
    else reviewRequired.push(`${product.id}/${batch.id}: modified or referenced; retain pending manual provenance review`);
  }
  const removeRecommendations=state.recommendations.filter(r=>removeBatches.includes(`${r.productId}/${r.batchId}`)&&r.createdAt===timestamp&&r.status==="pending").map(r=>r.id);
  const removeActivity=state.activity.filter(e=>e.type==="risk_detected"&&e.occurredAt===timestamp&&removeRecommendations.includes(e.recommendationId??"")).map(e=>e.id);
  return {digest:stateDigest(state),removeBatches,removeRecommendations,removeActivity,reviewRequired,preservedInvoices:state.invoiceIntakes.length,preservedTasks:state.tasks.length,needsExplicitConfirmation:true};
}
export function applyLegacyCleanup(state:AppState,confirmedDigest:string):AppState {
  const report=legacyCleanupReport(state);
  if(confirmedDigest!==report.digest)throw new Error("The migration report is stale. Review the latest report before confirming.");
  if(!report.removeBatches.length&&!report.removeRecommendations.length&&!report.removeActivity.length)throw new Error("No proven initial sample records are eligible for automatic removal.");
  const cleaned=structuredClone(state);
  for(const product of cleaned.products)product.batches=product.batches.filter(b=>!report.removeBatches.includes(`${product.id}/${b.id}`));
  cleaned.products=cleaned.products.filter(p=>p.batches.length||cleaned.invoiceIntakes.some(i=>i.proposals.some(l=>l.matchedProductId===p.id))||cleaned.tasks.some(t=>t.productId===p.id)||(cleaned.movements??[]).some(m=>m.productId===p.id));
  cleaned.recommendations=cleaned.recommendations.filter(r=>!report.removeRecommendations.includes(r.id));
  cleaned.activity=cleaned.activity.filter(e=>!report.removeActivity.includes(e.id));
  return cleaned;
}

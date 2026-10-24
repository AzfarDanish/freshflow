import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as database from "../src/lib/db";
import { createBusinessSeedState, reconcileRisks } from "../src/lib/expiry";
import { applyOperationalAction, operationalReport } from "../src/lib/operations";
import { applyReceivingAction } from "../src/lib/receiving";
import { answerFromFacts } from "../src/lib/assistant";
import { cappedRole, requireIdentity } from "../src/lib/identity";
import { legacyCleanupReport, applyLegacyCleanup } from "../src/lib/legacy-cleanup";
import { createSeedState } from "./fixtures/seed-state";
import type { AppState } from "../src/lib/types";
import type { BusinessIdentity } from "../src/lib/operational-types";
vi.mock("server-only",()=>({}));
const authMocks=vi.hoisted(()=>({auth:vi.fn(),currentUser:vi.fn()}));
vi.mock("@clerk/nextjs/server",()=>({...authMocks,clerkClient:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
const owner:BusinessIdentity={userId:"verified-owner",businessId:"freshflow-demo",actualRole:"owner",role:"owner"};
const staff:BusinessIdentity={...owner,userId:"verified-staff",actualRole:"staff",role:"staff"};
const now="2026-10-24T08:00:00.000Z";
function state():AppState {
  const s=createBusinessSeedState("freshflow-demo");
  s.products=[{id:"p",name:"Apples",sku:"APP",category:"Produce",unit:"kg",simulated:false,batches:[{id:"B",productId:"p",quantity:10,expiryDate:"2026-10-26",addedAt:now,simulated:false}]}];
  s.invoiceIntakes=[{id:"i",fileName:"invoice.csv",mimeType:"text/csv",fileSizeBytes:20,sha256:"test",uploadedAt:now,status:"review",processingStatus:"review",warnings:[],simulated:false,proposals:[{id:"l",productName:"Apples",sku:"APP",category:"Produce",quantity:8,unit:"kg",batchId:"DELIVERY",expiryDate:"2026-10-27",status:"pending",issues:[],matchedProductId:"p",unitPriceMinor:250}]}];
  return s;
}
function movement(overrides:Record<string,unknown>={}) {return {type:"record_movement",payload:{requestId:"request-sale",kind:"sale",productId:"p",batchId:"B",quantity:2,unitPriceMinor:500,unitCostMinor:250,reason:"Recorded till sale",occurredAt:now,...overrides}};}
function receipt(s:AppState,amount=3,requestId="receipt-request") {return {type:"receive_invoice",payload:{intakeId:"i",requestId,confirmed:true,lines:[{proposalId:"l",quantity:amount,batchId:"DELIVERY",expiryDate:"2026-10-27",matchMode:"existing",fields:{...s.invoiceIntakes[0].proposals[0]}}]}};}
beforeEach(()=>{vi.setSystemTime(new Date(now));authMocks.auth.mockResolvedValue({userId:null});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();authMocks.currentUser.mockClear();});
describe("real operational foundation",()=>{
  it("starts unknown businesses empty, never recreates a fixture",()=>expect(createBusinessSeedState("new-business").products).toEqual([]));
  it("persists sale deltas, retries idempotently and rejects conflicting request reuse",()=>{
    const s=state(),a=movement();applyOperationalAction(s,a,owner);applyOperationalAction(s,a,owner);
    expect(s.products[0].batches[0].quantity).toBe(8);expect(s.movements).toHaveLength(1);
    expect(()=>applyOperationalAction(s,movement({quantity:3}),owner)).toThrow("conflicts");
    expect(s.activity).toHaveLength(1);expect(s.activity[0]).toMatchObject({actor:"owner",actorId:"verified-owner",simulated:false});
  });
  it("rejects overselling, zero quantities and Staff management",()=>{
    for(const bad of [movement({quantity:11}),movement({quantity:0})])expect(()=>applyOperationalAction(state(),bad,owner)).toThrow();
    expect(()=>applyOperationalAction(state(),movement(),staff)).toThrow();
  });
  it("reverses once with immutable original history and deterministic amounts",()=>{
    const s=state();applyOperationalAction(s,movement(),owner);
    const original=structuredClone(s.movements![0]);
    const reverse={type:"reverse_movement",payload:{requestId:"reverse-request",movementId:original.id,reason:"Till entry corrected"}};
    applyOperationalAction(s,reverse,owner);applyOperationalAction(s,reverse,owner);
    expect(s.movements![0]).toEqual(original);expect(s.movements).toHaveLength(2);expect(s.products[0].batches[0].quantity).toBe(10);
    expect(operationalReport(s,"2026-10-24","2026-10-24").summary.saleRevenueMinor).toBe(0);
    expect(()=>applyOperationalAction(s,{...reverse,payload:{...reverse.payload,requestId:"another-reversal"}},owner)).toThrow("already");
  });
  it("does not turn absent prices, costs or history into fake zero metrics",()=>{
    const s=state();expect(operationalReport(s,"2026-10-24","2026-10-24").summary.saleRevenueMinor).toBeNull();
    applyOperationalAction(s,movement({kind:"waste",unitCostMinor:undefined}),owner);
    const summary=operationalReport(s,"2026-10-24","2026-10-24").summary;
    expect(summary.wasteCostMinor).toBeNull();expect(summary.unknownCosts).toBe(1);
  });
  it("removes depleted batches from active expiry recommendations",()=>{
    const s=state();reconcileRisks(s);expect(s.recommendations).toHaveLength(1);
    applyOperationalAction(s,movement({quantity:10}),owner);reconcileRisks(s);expect(s.recommendations.filter(r=>r.status==="pending")).toHaveLength(0);
  });
});
describe("invoice physical receiving",()=>{
  it("keeps upload/review separate from stock, supports partial repeated deliveries and idempotent retries",()=>{
    const s=state();expect(s.products[0].batches).toHaveLength(1);
    const first=receipt(s);applyReceivingAction(s,first,owner);applyReceivingAction(s,first,owner);
    expect(s.invoiceIntakes[0]).toMatchObject({status:"partial",proposals:[{quantity:8,receivedQuantity:3}]});
    applyReceivingAction(s,receipt(s,5,"second-delivery"),owner);
    expect(s.products[0].batches.find(b=>b.id==="DELIVERY")?.quantity).toBe(8);
    expect(s.invoiceIntakes[0].status).toBe("completed");expect(s.invoiceIntakes[0].receipts).toHaveLength(2);expect(s.movements).toHaveLength(2);
  });
  it("requires explicit confirmation, real product match, expiry, and an over-delivery reason",()=>{
    const s=state(),a=receipt(s);a.payload.confirmed=false;expect(()=>applyReceivingAction(s,a,owner)).toThrow("confirmation");
    expect(()=>applyReceivingAction(state(),receipt(s,9),owner)).toThrow("reason");
    const wrong=receipt(s);wrong.payload.lines[0].fields.matchedProductId="another-business-product";
    expect(()=>applyReceivingAction(state(),wrong,owner)).toThrow("Match");
    const missing=receipt(s);missing.payload.lines[0].expiryDate="";expect(()=>applyReceivingAction(state(),missing,owner)).toThrow("date");
  });
  it("records correction history without changing stock",()=>{
    const s=state(),line=s.invoiceIntakes[0].proposals[0];
    applyReceivingAction(s,{type:"update_invoice",payload:{intakeId:"i",reason:"Checked original invoice",header:{supplierName:"Verified supplier",invoiceNumber:"INV-1"},lines:[{proposalId:"l",fields:{...line,quantity:9},unitPriceMinor:270}]}},owner);
    expect(s.products[0].batches[0].quantity).toBe(10);expect(s.invoiceIntakes[0].corrections).toHaveLength(1);expect(s.invoiceIntakes[0].proposals[0].quantity).toBe(9);
  });
  it("traces receipt reversals back to received quantities without erasing the receipt",()=>{
    const s=state();applyReceivingAction(s,receipt(s),owner);
    const m=s.movements![0];applyOperationalAction(s,{type:"reverse_movement",payload:{requestId:"reverse-receipt",movementId:m.id,reason:"Incorrect receiving entry"}},owner);
    expect(s.invoiceIntakes[0].proposals[0].receivedQuantity).toBe(0);expect(s.invoiceIntakes[0].receipts).toHaveLength(1);expect(s.invoiceIntakes[0].corrections).toHaveLength(1);
  });
});
describe("read-only assistant and migration safety",()=>{
  it("caps role previews and rejects unauthenticated identity",async()=>{
    expect(cappedRole("staff","owner")).toBe("staff");expect(cappedRole("owner","staff")).toBe("staff");
    await expect(requireIdentity()).rejects.toMatchObject({status:401});
  });
  it("never bootstraps an inactive membership back into Owner access",async()=>{
    authMocks.auth.mockResolvedValue({userId:"revoked-owner"});
    vi.stubEnv("FRESHFLOW_BOOTSTRAP_OWNER_EMAIL","owner@example.test");
    const query=vi.fn().mockResolvedValue({rows:[{role:"owner",active:false}]});
    vi.spyOn(database,"getPool").mockReturnValue({query} as never);
    await expect(requireIdentity()).rejects.toMatchObject({status:403});
    expect(query).toHaveBeenCalledOnce();expect(authMocks.currentUser).not.toHaveBeenCalled();
  });
  it("rejects cross-business request scopes and cross-site mutations",async()=>{
    authMocks.auth.mockResolvedValue({userId:"verified-staff"});
    await expect(requireIdentity(new Request("https://freshflow.test/api/state?businessId=unrelated"))).rejects.toMatchObject({status:403});
    await expect(requireIdentity(new Request("https://freshflow.test/api/action",{method:"POST",headers:{origin:"https://attacker.test"}}))).rejects.toMatchObject({status:403});
  });
  it("grounds answers in actual batch evidence without mutating state",()=>{
    const s=state(),before=structuredClone(s),answer=answerFromFacts(s,{tool:"stock",search:"APP"},staff);
    expect(answer.evidence[0].facts.quantity).toBe(10);expect(s).toEqual(before);
    expect(()=>answerFromFacts(s,{tool:"insights"},staff)).toThrow("permissions");
  });
  it("requires exact confirmation and retains flag-only user entries, invoices, and work",()=>{
    const s=createSeedState();s.products.push({...state().products[0],simulated:true});
    const report=legacyCleanupReport(s);expect(report.removeBatches).toHaveLength(4);expect(report.reviewRequired).toHaveLength(1);
    expect(()=>applyLegacyCleanup(s,"stale")).toThrow("stale");
    const cleaned=applyLegacyCleanup(s,report.digest);expect(cleaned.products.map(p=>p.id)).toEqual(["p"]);
    s.products[0].batches[0].quantity=7;expect(legacyCleanupReport(s).removeBatches).toHaveLength(3);
  });
  it("rejects unsigned calls on every operational API even with forged Owner input",async()=>{
    const routes=await Promise.all([import("../app/api/state/route"),import("../app/api/action/route"),import("../app/api/role/route"),import("../app/api/operations/route"),import("../app/api/receiving/route"),import("../app/api/invoices/route"),import("../app/api/assistant/route"),import("../app/api/members/route"),import("../app/api/migration/route")]);
    for(const route of routes) {
      const handler="POST"in route?route.POST:route.GET;
      const response=await handler(new Request("https://freshflow.test/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:"owner",confirmed:true,businessId:"another-business"})}));
      expect(response.status).toBe(401);
    }
  });
});

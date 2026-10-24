import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBusinessSeedState, reconcileRisks } from "../src/lib/expiry";
import { applyOperationalAction, operationalReport } from "../src/lib/operations";
import { applyReceivingAction } from "../src/lib/receiving";
import { answerFromFacts, inventoryQuestion } from "../src/lib/assistant";
import { getPool } from "../src/lib/db";
import { getPreviewIdentity } from "../src/lib/identity";
import { PREVIEW_ROLE_COOKIE, signPreviewRoleCookie } from "../src/lib/role-session";
import { legacyCleanupReport, applyLegacyCleanup } from "../src/lib/legacy-cleanup";
import { createSeedState } from "./fixtures/seed-state";
import type { AppState } from "../src/lib/types";
import type { BusinessIdentity } from "../src/lib/operational-types";
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock("../src/lib/db",()=>({getPool:vi.fn()}));
const owner:BusinessIdentity={userId:"verified-owner",businessId:"freshflow-demo",actualRole:"owner",role:"owner"};
const staff:BusinessIdentity={...owner,userId:"verified-staff",actualRole:"staff",role:"staff"};
const now="2026-10-24T08:00:00.000Z";
function state():AppState {
  const s=createBusinessSeedState("freshflow-demo");
  s.products=[{id:"p",name:"Apples",sku:"APP",category:"Produce",unit:"kg",simulated:false,batches:[{id:"B",productId:"p",quantity:10,expiryDate:"2026-10-26",addedAt:now,simulated:false}]}];
  s.invoiceIntakes=[{id:"i",fileName:"invoice.csv",mimeType:"text/csv",fileSizeBytes:20,sha256:"test",uploadedAt:now,status:"review",processingStatus:"review",warnings:[],simulated:false,proposals:[{id:"l",productName:"Apples",sku:"APP",category:"Produce",quantity:8,unit:"kg",batchId:"DELIVERY",expiryDate:"2026-10-27",status:"pending",issues:[],matchedProductId:"p",unitPriceMinor:250}]}];
  return s;
}
function movement(overrides:Record<string,unknown>={}) {return {type:"record_movement",payload:{requestId:"request-waste",kind:"waste",productId:"p",batchId:"B",quantity:2,unitCostMinor:250,reason:"Expired stock discarded",occurredAt:now,...overrides}};}
function receipt(s:AppState,amount=3,requestId="receipt-request") {return {type:"receive_invoice",payload:{intakeId:"i",requestId,confirmed:true,lines:[{proposalId:"l",quantity:amount,batchId:"DELIVERY",expiryDate:"2026-10-27",matchMode:"existing",fields:{...s.invoiceIntakes[0].proposals[0]}}]}};}
beforeEach(()=>{vi.setSystemTime(new Date(now));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("real operational foundation",()=>{
  it("starts unknown businesses empty, never recreates a fixture",()=>expect(createBusinessSeedState("new-business").products).toEqual([]));
  it("persists waste deltas, retries idempotently and rejects conflicting request reuse",()=>{
    const s=state(),a=movement();applyOperationalAction(s,a,owner);applyOperationalAction(s,a,owner);
    expect(s.products[0].batches[0].quantity).toBe(8);expect(s.movements).toHaveLength(1);
    expect(()=>applyOperationalAction(s,movement({quantity:3}),owner)).toThrow("conflicts");
    expect(s.activity).toHaveLength(1);expect(s.activity[0]).toMatchObject({actor:"owner",actorId:"verified-owner",simulated:false});
  });
  it("rejects manual sales, over-wasting, zero quantities and Staff management",()=>{
    expect(()=>applyOperationalAction(state(),movement({kind:"sale"}),owner)).toThrow("Manual sale recording is disabled");
    for(const bad of [movement({quantity:11}),movement({quantity:0})])expect(()=>applyOperationalAction(state(),bad,owner)).toThrow();
    expect(()=>applyOperationalAction(state(),movement(),staff)).toThrow();
  });
  it("records stock corrections with previous quantity, corrected quantity, difference and mandatory reason",()=>{
    const s=state();
    const corr={type:"record_movement",payload:{requestId:"corr-1",kind:"adjustment",productId:"p",batchId:"B",correctedQuantity:7,reason:"Physical stock-take audit",occurredAt:now}};
    applyOperationalAction(s,corr,owner);
    expect(s.products[0].batches[0].quantity).toBe(7);
    expect(s.movements).toHaveLength(1);
    expect(s.movements![0]).toMatchObject({
      kind:"adjustment",
      quantity:-3,
      previousQuantity:10,
      correctedQuantity:7,
      reason:"Physical stock-take audit",
    });
    expect(s.activity[0].title).toBe("Stock discrepancy correction recorded");
  });
  it("reverses once with immutable original history and deterministic amounts",()=>{
    const s=state();applyOperationalAction(s,movement(),owner);
    const original=structuredClone(s.movements![0]);
    const reverse={type:"reverse_movement",payload:{requestId:"reverse-request",movementId:original.id,reason:"Waste entry corrected"}};
    applyOperationalAction(s,reverse,owner);applyOperationalAction(s,reverse,owner);
    expect(s.movements![0]).toEqual(original);expect(s.movements).toHaveLength(2);expect(s.products[0].batches[0].quantity).toBe(10);
    expect(operationalReport(s,"2026-10-24","2026-10-24").summary.wasteCostMinor).toBe(0);
    expect(()=>applyOperationalAction(s,{...reverse,payload:{...reverse.payload,requestId:"another-reversal"}},owner)).toThrow("already");
  });
  it("does not turn absent prices, costs or history into fake zero metrics",()=>{
    const s=state();expect(operationalReport(s,"2026-10-24","2026-10-24").summary.wasteCostMinor).toBeNull();
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
  it("lets anyone select the signed Owner or Staff testing profile without authentication",async()=>{
    const profile=(role:"owner"|"staff")=>getPreviewIdentity(new Request("https://freshflow.test/api/state",{headers:{cookie:`${PREVIEW_ROLE_COOKIE}=${signPreviewRoleCookie(role)}`}}));
    expect((await getPreviewIdentity()).role).toBe("staff");
    await expect(profile("owner")).resolves.toMatchObject({role:"owner",userId:"testing-preview-owner"});
    await expect(profile("staff")).resolves.toMatchObject({role:"staff",userId:"testing-preview-staff"});
    await expect(getPreviewIdentity(new Request("https://freshflow.test/api/state?businessId=unrelated"))).rejects.toMatchObject({status:403});
  });
  it("rejects cross-site mutations and limits fake profile roles to the existing matrix",async()=>{
    await expect(getPreviewIdentity(new Request("https://freshflow.test/api/action",{method:"POST",headers:{origin:"https://attacker.test"}}))).rejects.toMatchObject({status:403});
    const inventory=state();
    expect(()=>applyOperationalAction(inventory,movement(),staff)).toThrow();
  });
  it("grounds answers in actual batch evidence without mutating state",()=>{
    const s=state(),before=structuredClone(s),answer=answerFromFacts(s,{tool:"stock",search:"APP"},staff);
    expect(answer.evidence[0].facts.quantity).toBe(10);expect(s).toEqual(before);
    expect(()=>answerFromFacts(s,{tool:"insights"},staff)).toThrow("permissions");
  });
  it("uses OpenRouter's selected DeepSeek model to plan a question, then grounds results in the latest stored state",async()=>{
    const stored=state();stored.products[0].batches[0].quantity=7;
    const query=vi.fn().mockResolvedValue({rows:[{state:stored}]});
    vi.mocked(getPool).mockReturnValue({query} as unknown as ReturnType<typeof getPool>);
    vi.stubEnv("OPENROUTER_API_KEY","test-openrouter-key");
    const fetchMock=vi.fn(async (_input:RequestInfo|URL, _init?:RequestInit)=>new Response(JSON.stringify({
      choices:[{message:{content:[{type:"text",text:'Plan:\n```json\n{"tool":"stock","search":"APP"}\n```'}]}}],
    }),{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetchMock);

    const response=await inventoryQuestion("How many apples are recorded?",staff,{});

    expect(query).toHaveBeenNthCalledWith(
      1,
      "SELECT state #>> '{settings,timeZone}' AS timezone FROM freshflow_business_state WHERE business_id=$1",
      [staff.businessId],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT state FROM freshflow_business_state WHERE business_id=$1",
      [staff.businessId],
    );
    expect(response.evidence[0].facts.quantity).toBe(7);
    expect(response.answer).toContain("1 matching stock batch");
    const requestBody=JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(requestBody.max_tokens).toBe(1000);
    expect(requestBody.messages[0].content).toContain("Effective role: staff");
  });
  it("does not read operational records when the provider returns an unusable plan",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{timezone:"Asia/Kuala_Lumpur"}]});
    vi.mocked(getPool).mockReturnValue({query} as unknown as ReturnType<typeof getPool>);
    vi.stubEnv("OPENROUTER_API_KEY","test-openrouter-key");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      choices:[{message:{content:'```json\n{"tool":\n```'}}],
    }),{status:200,headers:{"Content-Type":"application/json"}})));

    await expect(inventoryQuestion("How many apples are recorded?",staff,{}))
      .rejects.toMatchObject({status:502,message:expect.stringContaining("No inventory records were read")});
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      "SELECT state #>> '{settings,timeZone}' AS timezone FROM freshflow_business_state WHERE business_id=$1",
      [staff.businessId],
    );
  });
  it("fails clearly without OpenRouter credentials and does not fabricate an answer",async()=>{
    vi.stubEnv("OPENROUTER_API_KEY","");
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(inventoryQuestion("How many apples are recorded?",staff,{}))
      .rejects.toMatchObject({status:503,message:expect.stringContaining("OpenRouter API key")});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports provider outages without returning a fabricated answer",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{state:state()}]});
    vi.mocked(getPool).mockReturnValue({query} as unknown as ReturnType<typeof getPool>);
    vi.stubEnv("OPENROUTER_API_KEY","test-openrouter-key");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("upstream unavailable",{status:503})));
    await expect(inventoryQuestion("How many apples are recorded?",staff,{}))
      .rejects.toMatchObject({status:503,message:expect.stringContaining("OpenRouter connection")});
  });
  it("enforces Staff restrictions even when the model selects a protected query",async()=>{
    const stored=state(),query=vi.fn().mockResolvedValue({rows:[{state:stored}]});
    vi.mocked(getPool).mockReturnValue({query} as unknown as ReturnType<typeof getPool>);
    vi.stubEnv("OPENROUTER_API_KEY","test-openrouter-key");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      choices:[{message:{content:JSON.stringify({tool:"insights"})}}],
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    await expect(inventoryQuestion("What is the revenue?",staff,{}))
      .rejects.toMatchObject({status:403,message:expect.stringContaining("permissions")});
  });
  it("also rejects Staff access to pending decision details",async()=>{
    const stored=state(),query=vi.fn().mockResolvedValue({rows:[{state:stored}]});
    vi.mocked(getPool).mockReturnValue({query} as unknown as ReturnType<typeof getPool>);
    vi.stubEnv("OPENROUTER_API_KEY","test-openrouter-key");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      choices:[{message:{content:JSON.stringify({tool:"decisions"})}}],
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    await expect(inventoryQuestion("Which decisions are pending?",staff,{}))
      .rejects.toMatchObject({status:403,message:expect.stringContaining("permissions")});
  });
  it("requires exact confirmation and retains flag-only user entries, invoices, and work",()=>{
    const s=createSeedState();s.products.push({...state().products[0],simulated:true});
    const report=legacyCleanupReport(s);expect(report.removeBatches).toHaveLength(4);expect(report.reviewRequired).toHaveLength(1);
    expect(()=>applyLegacyCleanup(s,"stale")).toThrow("stale");
    const cleaned=applyLegacyCleanup(s,report.digest);expect(cleaned.products.map(p=>p.id)).toEqual(["p"]);
    s.products[0].batches[0].quantity=7;expect(legacyCleanupReport(s).removeBatches).toHaveLength(3);
  });
  it("lets an unsigned visitor persist a selected testing profile",async()=>{
    const {POST}=await import("../app/api/role/route");
    const response=await POST(new Request("https://freshflow.test/api/role",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:"owner"})}));
    expect(response.status).toBe(200);
    expect(response.cookies.get(PREVIEW_ROLE_COOKIE)?.value).toBe(signPreviewRoleCookie("owner"));
  });
});

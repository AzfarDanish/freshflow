import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { getPool } from "../src/lib/db";
import { withBusinessState } from "../src/lib/store";
import { applyReceivingAction } from "../src/lib/receiving";
import { createBusinessSeedState } from "../src/lib/expiry";
vi.mock("server-only",()=>({}));
it.skipIf(!process.env.DATABASE_URL)("serializes concurrent receiving retries in PostgreSQL and rolls back a multi-line failure",async()=>{
  const businessId=`verification-${randomUUID()}`,pool=getPool();
  const identity={userId:"verification-owner",businessId,actualRole:"owner" as const,role:"owner" as const};
  const state=createBusinessSeedState(businessId);
  const fields={productName:"Verification product",sku:"VERIFY",category:"Verification",quantity:8,unit:"units",batchId:"VERIFY-B",expiryDate:"2027-01-01"};
  state.invoiceIntakes=[{id:"verify-invoice",fileName:"verification.csv",mimeType:"text/csv",fileSizeBytes:1,sha256:"verification-only",uploadedAt:new Date().toISOString(),status:"review",processingStatus:"review",warnings:[],simulated:false,proposals:[{...fields,id:"verify-line",status:"pending",issues:[]}]}];
  await pool.query("INSERT INTO freshflow_business_state (business_id,state) VALUES($1,$2::jsonb)",[businessId,JSON.stringify(state)]);
  const action={type:"receive_invoice",payload:{intakeId:"verify-invoice",requestId:"same-physical-receipt",confirmed:true,lines:[{proposalId:"verify-line",quantity:3,batchId:"VERIFY-B",expiryDate:"2027-01-01",matchMode:"new",fields}]}};
  const execute=()=>withBusinessState(businessId,async state=>{applyReceivingAction(state,action,identity);return {state,value:null};});
  try {
    await Promise.all([execute(),execute(),execute()]);
    const result=await pool.query("SELECT state FROM freshflow_business_state WHERE business_id=$1",[businessId]);
    expect(result.rows[0].state.products[0].batches[0].quantity).toBe(3);
    expect(result.rows[0].state.invoiceIntakes[0].receipts).toHaveLength(1);
    expect(result.rows[0].state.movements).toHaveLength(1);
    const saved=JSON.stringify(result.rows[0].state);
    await expect(withBusinessState(businessId,async state=>{
      const productId=state.products[0].id;
      applyReceivingAction(state,{type:"receive_invoice",payload:{intakeId:"verify-invoice",requestId:"rollback-receipt",confirmed:true,lines:[
        {...action.payload.lines[0],matchMode:"existing",fields:{...fields,matchedProductId:productId},quantity:1},
        {...action.payload.lines[0],proposalId:"missing-line"},
      ]}},identity);
      return {state,value:null};
    })).rejects.toThrow("active invoice line");
    expect(JSON.stringify((await pool.query("SELECT state FROM freshflow_business_state WHERE business_id=$1",[businessId])).rows[0].state)).toBe(saved);
  } finally {await pool.query("DELETE FROM freshflow_business_state WHERE business_id=$1",[businessId]);}
},30000);

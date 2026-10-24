import { NextResponse } from "next/server";
import { getPreviewIdentity, requireOwner, rejectOtherBusiness, errorStatus } from "@/src/lib/identity";
import { recordObject } from "@/src/lib/operations";
import { applyReceivingAction } from "@/src/lib/receiving";
import { withBusinessState, stateResponse, deleteInvoiceDocument } from "@/src/lib/store";
import { runPersistedProcessing } from "@/src/lib/invoice-processing";
import { reconcileRisks } from "@/src/lib/expiry";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    const identity=await getPreviewIdentity(request);requireOwner(identity);
    const body=recordObject(await request.json());rejectOtherBusiness(body.businessId,identity);
    const payload=recordObject(body.payload);
    const value=body.type==="retry_processing"
      ?await runPersistedProcessing(identity,String(payload.intakeId),true)
      :await withBusinessState(identity.businessId,async(state,client,mode)=>{
        if (body.type === "cancel_invoice") {
          applyReceivingAction(state,body,identity);
          reconcileRisks(state);
          await deleteInvoiceDocument(identity.businessId,String(payload.intakeId),client).catch(()=>undefined);
          return {state,value:stateResponse(state,mode,identity.businessId,identity.role)};
        }
        applyReceivingAction(state,body,identity);reconcileRisks(state);
        return {state,value:stateResponse(state,mode,identity.businessId,identity.role)};
      });
    return NextResponse.json(value,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not save receiving."},{status:errorStatus(error)});}
}

import { NextResponse } from "next/server";
import { requireIdentity, requireOwner, rejectOtherBusiness, errorStatus } from "@/src/lib/identity";
import { recordObject } from "@/src/lib/operations";
import { applyReceivingAction } from "@/src/lib/receiving";
import { withBusinessState, stateResponse } from "@/src/lib/store";
import { runPersistedProcessing } from "@/src/lib/invoice-processing";
import { reconcileRisks } from "@/src/lib/expiry";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    const identity=await requireIdentity(request);requireOwner(identity);
    const body=recordObject(await request.json());rejectOtherBusiness(body.businessId,identity);
    const payload=recordObject(body.payload);
    const value=body.type==="retry_processing"
      ?await runPersistedProcessing(identity,String(payload.intakeId),true)
      :await withBusinessState(identity.businessId,async(state,_,mode)=>{
        applyReceivingAction(state,body,identity);reconcileRisks(state);
        return {state,value:stateResponse(state,mode,identity.businessId,identity.role)};
      });
    return NextResponse.json(value,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not save receiving."},{status:errorStatus(error)});}
}

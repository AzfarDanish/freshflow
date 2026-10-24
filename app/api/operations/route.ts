import { NextResponse } from "next/server";
import { getPreviewIdentity, requireOwner, errorStatus, rejectOtherBusiness } from "@/src/lib/identity";
import { applyOperationalAction, operationalReport, businessDate, recordObject } from "@/src/lib/operations";
import { getCurrentState, withBusinessState } from "@/src/lib/store";
import { reconcileRisks } from "@/src/lib/expiry";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const identity=await getPreviewIdentity(request);requireOwner(identity);
    const url=new URL(request.url),today=businessDate(new Date().toISOString());
    const {state}=await getCurrentState(identity.businessId);
    return NextResponse.json(operationalReport(state,url.searchParams.get("from")??today,url.searchParams.get("to")??today),{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not load operations."},{status:errorStatus(error)});}
}
export async function POST(request:Request) {
  try {
    const identity=await getPreviewIdentity(request);requireOwner(identity);
    const body=recordObject(await request.json());rejectOtherBusiness(body.businessId,identity);
    const value=await withBusinessState(identity.businessId,async state=>{
      applyOperationalAction(state,body,identity);reconcileRisks(state);
      const today=businessDate(new Date().toISOString(),state.settings.timeZone);
      return {state,value:operationalReport(state,today,today)};
    });
    return NextResponse.json(value,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not save operation."},{status:errorStatus(error)});}
}

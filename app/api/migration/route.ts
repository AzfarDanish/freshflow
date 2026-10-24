import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireIdentity, requireOwner, errorStatus } from "@/src/lib/identity";
import { getPool } from "@/src/lib/db";
import { legacyCleanupReport, applyLegacyCleanup, stateDigest } from "@/src/lib/legacy-cleanup";
import { recordObject, addOperationalActivity } from "@/src/lib/operations";
import { withBusinessState, stateResponse } from "@/src/lib/store";
import type { AppState } from "@/src/lib/types";
export async function GET(request:Request) {
  try {
    const identity=await requireIdentity(request);requireOwner(identity);
    const result=await getPool().query<{state:AppState}>("SELECT state FROM freshflow_business_state WHERE business_id=$1",[identity.businessId]);
    return NextResponse.json({report:result.rows[0]?legacyCleanupReport(result.rows[0].state):null},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not inspect legacy records."},{status:errorStatus(error)});}
}
export async function POST(request:Request) {
  try {
    const identity=await requireIdentity(request);requireOwner(identity);
    const body=recordObject(await request.json());
    if(body.confirmed!==true||typeof body.digest!=="string")throw new Error("Review the migration report and explicitly confirm its exact digest.");
    const result=await withBusinessState(identity.businessId,async(_,client,mode)=>{
      if(!client)throw new Error("Reviewed migration requires PostgreSQL backup storage.");
      const result=await client.query<{state:AppState}>("SELECT state FROM freshflow_business_state WHERE business_id=$1",[identity.businessId]);
      const original=result.rows[0]?.state;if(!original)throw new Error("No stored state was found.");
      const cleaned=applyLegacyCleanup(original,body.digest as string);
      const backupId=`backup-${randomUUID()}`;
      await client.query("INSERT INTO freshflow_state_backups (id,business_id,state,digest) VALUES($1,$2,$3::jsonb,$4)",[backupId,identity.businessId,JSON.stringify(original),stateDigest(original)]);
      addOperationalActivity(cleaned,identity,"legacy_cleanup","Reviewed sample-data cleanup",`Proven initial fixture records were removed after exact-report confirmation. Original state retained in backup ${backupId}.`);
      return {state:cleaned,value:{...stateResponse(cleaned,mode,identity.businessId,identity.role),backupId}};
    });
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Migration was not applied."},{status:errorStatus(error)});}
}

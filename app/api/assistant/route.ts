import { NextResponse } from "next/server";
import { requireIdentity, errorStatus, rejectOtherBusiness, IdentityError } from "@/src/lib/identity";
import { recordObject } from "@/src/lib/operations";
import { inventoryQuestion } from "@/src/lib/assistant";
const limits=new Map<string,{at:number;count:number}>();
export async function POST(request:Request) {
  try {
    const identity=await requireIdentity(request),body=recordObject(await request.json());
    rejectOtherBusiness(body.businessId,identity);
    const key=identity.businessId+":"+identity.userId;
    if(limits.size>5000)for(const [k,v]of limits)if(Date.now()-v.at>60000)limits.delete(k);
    const limit=limits.get(key);
    if(limit&&Date.now()-limit.at<60000){if(limit.count>=8)throw new IdentityError("Please wait a minute before asking another question.",429);limit.count++;}
    else limits.set(key,{at:Date.now(),count:1});
    if(body.mode==="insights"&&identity.role!=="owner")throw new IdentityError("Financial insights require Owner permissions.",403);
    const optional=(v:unknown)=>v===undefined?undefined:typeof v==="string"?v:(()=>{throw new Error("Query options must be text.");})();
    return NextResponse.json(await inventoryQuestion(body.question,identity,{from:optional(body.from),to:optional(body.to),mode:optional(body.mode)}),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"The assistant could not answer this question."},{status:errorStatus(error)});}
}

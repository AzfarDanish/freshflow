import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireIdentity, requireOwner, errorStatus } from "@/src/lib/identity";
import { getPool } from "@/src/lib/db";
import { recordObject, requiredText, addOperationalActivity } from "@/src/lib/operations";
import { withBusinessState } from "@/src/lib/store";
export async function GET(request:Request) {
  try {
    const identity=await requireIdentity(request);requireOwner(identity);
    const rows=await getPool().query('SELECT user_id AS "userId", role, active FROM freshflow_memberships WHERE business_id=$1 ORDER BY user_id',[identity.businessId]);
    return NextResponse.json({members:rows.rows},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not load team access."},{status:errorStatus(error)});}
}
export async function POST(request:Request) {
  try {
    const identity=await requireIdentity(request);requireOwner(identity);
    const body=recordObject(await request.json());
    let targetId:string;
    if(body.active===false)targetId=requiredText(body.userId,"Member reference",100);
    else {
      if(body.role!=="staff"||body.active!==true)throw new Error("This screen can grant Staff access only.");
      const email=requiredText(body.email,"Verified account email",254).toLowerCase();
      const client=await clerkClient();
      const users=await client.users.getUserList({emailAddress:[email],limit:2});
      const user=users.data.find(u=>u.emailAddresses.some(e=>e.emailAddress.toLowerCase()===email&&e.verification?.status==="verified"));
      if(!user)throw new Error("No verified account matches this email. Ask the staff member to sign up and verify their email first.");
      targetId=user.id;
    }
    await withBusinessState(identity.businessId,async(state,client)=>{
      if(!client)throw new Error("Team membership requires PostgreSQL.");
      const existing=await client.query("SELECT role FROM freshflow_memberships WHERE user_id=$1 AND business_id=$2 FOR UPDATE",[targetId,identity.businessId]);
      if(existing.rows[0]?.role==="owner")throw new Error("Owner membership cannot be changed from this Staff-access screen.");
      if(body.active===false&&!existing.rows.length)throw new Error("Staff membership not found.");
      await client.query(`INSERT INTO freshflow_memberships (user_id,business_id,role,active,granted_by) VALUES ($1,$2,'staff',$3,$4)
        ON CONFLICT (user_id,business_id) DO UPDATE SET active=excluded.active,granted_by=excluded.granted_by,updated_at=now()`,
      [targetId,identity.businessId,body.active===true,identity.userId]);
      addOperationalActivity(state,identity,"member_changed","Staff access updated",body.active===true?"Verified staff account was granted business access.":"Staff business access was revoked.");
      return {state,value:null};
    });
    return NextResponse.json({success:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not update access."},{status:errorStatus(error)});}
}

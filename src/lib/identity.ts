import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_BUSINESS_ID, requireBusinessWorkspace } from "./businesses";
import type { BusinessIdentity } from "./operational-types";
import type { Role } from "./types";
import { PREVIEW_ROLE_COOKIE, roleFromRequest, verifyPreviewRoleCookie } from "./role-session";

/** Hackathon testing context only. This is not authentication or security. */
export class IdentityError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function getPreviewIdentity(request?:Request):Promise<BusinessIdentity> {
  if(request&&!["GET","HEAD","OPTIONS"].includes(request.method)) {
    const origin=request.headers.get("origin");
    const hosts=[new URL(request.url).host,request.headers.get("host"),request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()].filter(Boolean);
    if(request.headers.get("sec-fetch-site")==="cross-site"||(origin&&(!URL.canParse(origin)||!hosts.includes(new URL(origin).host))))throw new IdentityError("Cross-site operational requests are not permitted.",403);
  }
  const businessId=process.env.FRESHFLOW_BUSINESS_ID||DEFAULT_BUSINESS_ID;
  requireBusinessWorkspace(businessId);
  if(request) {
    const requested=new URL(request.url).searchParams.get("businessId");
    if(requested&&requested!==businessId)throw new IdentityError("Business access denied.",403);
  }
  let role:Role;
  if(request)role=roleFromRequest(request);
  else {
    const store=await cookies();
    role=verifyPreviewRoleCookie(store.get(PREVIEW_ROLE_COOKIE)?.value);
  }
  return {userId:`testing-preview-${role}`,businessId,actualRole:role,role};
}
export function rejectOtherBusiness(value:unknown,identity:BusinessIdentity) {
  if(value!==undefined&&value!==identity.businessId)throw new IdentityError("Business access denied.",403);
}
export function requireOwner(identity:BusinessIdentity) {
  if(identity.role!=="owner")throw new IdentityError("Select the Owner testing profile to continue.",403);
}
export function errorStatus(error:unknown):number {
  return error&&typeof error==="object"&&"status"in error&&typeof error.status==="number"?error.status:400;
}

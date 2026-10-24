import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { getPool } from "./db";
import { DEFAULT_BUSINESS_ID, requireBusinessWorkspace } from "./businesses";
import type { BusinessIdentity } from "./operational-types";
import type { Role } from "./types";
import { PREVIEW_ROLE_COOKIE, verifyPreviewRoleCookie } from "./role-session";

export class IdentityError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function cappedRole(actualRole: Role, selectedRole: Role): Role {
  return actualRole === "owner" && selectedRole === "owner" ? "owner" : "staff";
}

export async function requireIdentity(request?: Request): Promise<BusinessIdentity> {
  if(request&&!["GET","HEAD","OPTIONS"].includes(request.method)) {
    const origin=request.headers.get("origin");
    const hosts=[new URL(request.url).host,request.headers.get("host"),request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()].filter(Boolean);
    if(request.headers.get("sec-fetch-site")==="cross-site"||(origin&&(!URL.canParse(origin)||!hosts.includes(new URL(origin).host))))throw new IdentityError("Cross-site operational requests are not permitted.",403);
  }
  const { userId } = await auth();
  if (!userId) throw new IdentityError("Sign in to access business records.", 401);
  const businessId = process.env.FRESHFLOW_BUSINESS_ID || DEFAULT_BUSINESS_ID;
  requireBusinessWorkspace(businessId);
  const requested = request ? new URL(request.url).searchParams.get("businessId") : null;
  if (requested && requested !== businessId) throw new IdentityError("Business access denied.", 403);
  let result = await getPool().query<{ role: Role; active: boolean }>(
    "SELECT role, active FROM freshflow_memberships WHERE user_id=$1 AND business_id=$2",
    [userId, businessId],
  );
  if (!result.rows.length && process.env.FRESHFLOW_BOOTSTRAP_OWNER_EMAIL) {
    const user = await currentUser();
    const configured = process.env.FRESHFLOW_BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase();
    const verified = user?.emailAddresses.some((email) =>
      email.emailAddress.toLowerCase() === configured && email.verification?.status === "verified");
    if (verified) {
      await getPool().query(
        `INSERT INTO freshflow_memberships (user_id,business_id,role,active,granted_by)
         VALUES ($1,$2,'owner',true,'configured-bootstrap') ON CONFLICT DO NOTHING`,
        [userId, businessId],
      );
      result = await getPool().query(
        "SELECT role, active FROM freshflow_memberships WHERE user_id=$1 AND business_id=$2", [userId,businessId],
      );
    }
  }
  const membership = result.rows[0];
  if (!membership?.active || !["owner", "staff"].includes(membership.role)) {
    throw new IdentityError("This account has no active business membership. Ask the Owner for access. Initial Owner setup requires FRESHFLOW_BOOTSTRAP_OWNER_EMAIL matching a verified account.", 403);
  }
  const cookieStore = await cookies();
  const raw = cookieStore.get(PREVIEW_ROLE_COOKIE)?.value;
  const selected = raw ? verifyPreviewRoleCookie(raw) : membership.role;
  return { userId, businessId, actualRole: membership.role, role: cappedRole(membership.role, selected) };
}

export function rejectOtherBusiness(value: unknown, identity: BusinessIdentity): void {
  if (value !== undefined && value !== identity.businessId) throw new IdentityError("Business access denied.", 403);
}

export function requireOwner(identity: BusinessIdentity): void {
  if (identity.role !== "owner") throw new IdentityError("This operation requires Owner permissions.", 403);
}

export function errorStatus(error: unknown): number {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 400;
}

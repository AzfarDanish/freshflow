import { NextResponse } from "next/server";
import {
  PREVIEW_ROLE_COOKIE,
  previewRoleCookieOptions,
  signPreviewRoleCookie,
} from "@/src/lib/role-session";
import type { Role } from "@/src/lib/types";
import { requireIdentity, IdentityError, errorStatus } from "@/src/lib/identity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = await requireIdentity(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("role" in body) ||
        (body.role !== "owner" && body.role !== "staff")) {
      return NextResponse.json({ error: "Choose the Owner or Staff preview role." }, { status: 400 });
    }
    const role = body.role as Role;
    if (role === "owner" && identity.actualRole !== "owner") throw new IdentityError("The preview cannot grant Owner permissions to Staff.", 403);
    const response = NextResponse.json({ role }, {
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set(PREVIEW_ROLE_COOKIE, signPreviewRoleCookie(role), previewRoleCookieOptions);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not change the preview role.";
    return NextResponse.json({ error: message }, { status: errorStatus(error) });
  }
}

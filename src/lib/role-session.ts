import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canAccessOperation } from "@/src/lib/access-control";
import type { OperationId } from "@/src/lib/operation-navigation";
import type { Role } from "@/src/lib/types";

export const PREVIEW_ROLE_COOKIE = "freshflow-preview-role";
const COOKIE_LIFETIME_SECONDS = 60 * 60 * 12;
const ROLE_COOKIE_CONTEXT = "freshflow-preview-role:v1:";
const TEST_ONLY_SECRET = "freshflow-test-only-role-cookie-key";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "test") return TEST_ONLY_SECRET;
  throw new Error("SESSION_SECRET is required to verify the preview role.");
}

function signRole(role: Role): string {
  return createHmac("sha256", sessionSecret())
    .update(`${ROLE_COOKIE_CONTEXT}${role}`)
    .digest("hex");
}

export function signPreviewRoleCookie(role: Role): string {
  return `${role}.${signRole(role)}`;
}

export function verifyPreviewRoleCookie(value: string | undefined): Role {
  if (!value) return "owner";
  const separator = value.indexOf(".");
  if (separator === -1) return "staff";
  const role = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if ((role !== "owner" && role !== "staff") || !/^[a-f0-9]{64}$/.test(signature)) {
    return "staff";
  }
  const expected = signRole(role);
  const actualBytes = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return timingSafeEqual(actualBytes, expectedBytes) ? role : "staff";
}

export function roleFromRequest(request: Request): Role {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader.split(";").map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${PREVIEW_ROLE_COOKIE}=`))
    ?.slice(PREVIEW_ROLE_COOKIE.length + 1);
  return verifyPreviewRoleCookie(raw ? decodeURIComponent(raw) : undefined);
}

export async function requirePageRole(operation: OperationId): Promise<void> {
  const cookieStore = await cookies();
  const role = verifyPreviewRoleCookie(cookieStore.get(PREVIEW_ROLE_COOKIE)?.value);
  if (!canAccessOperation(role, operation)) redirect("/");
}

export const previewRoleCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: COOKIE_LIFETIME_SECONDS,
  secure: process.env.NODE_ENV === "production",
};

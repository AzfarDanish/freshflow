import { clerkMiddleware } from "@clerk/nextjs/server";
import { publishableKeyFromHost } from "@clerk/shared/keys";

export default clerkMiddleware(async () => {}, (request) => ({
  publishableKey: publishableKeyFromHost(
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.nextUrl.hostname,
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
}));
export const config = {
  matcher: ["/((?!_next|.*\\.(?:svg|png|jpg|jpeg|ico|css|js)$).*)", "/api/(.*)"],
};

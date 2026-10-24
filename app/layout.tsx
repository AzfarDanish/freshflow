import type { Metadata } from "next";
import "./globals.css";
import OperationsWorkspace from "./operations/OperationsWorkspace";
import IdentityBoundary from "./auth/IdentityBoundary";
import { ClerkProvider } from "@clerk/nextjs";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "FreshFlow | Inventory operations",
  description: "Inventory exceptions, verified owner decisions, supplier receiving and staff actions for small grocers.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "";
  const publishableKey = publishableKeyFromHost(host.split(":")[0], process.env.CLERK_PUBLISHABLE_KEY);
  return (
    <html lang="en">
      <body><ClerkProvider publishableKey={publishableKey}
        proxyUrl={process.env.CLERK_PROXY_URL || process.env.VITE_CLERK_PROXY_URL}
        signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/"
        appearance={{ variables: { colorPrimary: "#167b55", colorForeground: "#20252a", colorBackground: "#ffffff", fontFamily: "Arial, sans-serif" }, elements: { cardBox: { width: "420px", maxWidth: "100%", background: "#ffffff" } } }}>
        <IdentityBoundary>{children}</IdentityBoundary>
      </ClerkProvider></body>
    </html>
  );
}

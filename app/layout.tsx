import type { Metadata } from "next";
import "./globals.css";
import OperationsWorkspace from "./operations/OperationsWorkspace";

export const metadata: Metadata = {
  title: "FreshFlow | Inventory operations",
  description: "Expiry-risk exceptions, owner decisions and staff actions for small grocers. Runs on synthetic sample data with simulated roles.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><OperationsWorkspace>{children}</OperationsWorkspace></body>
    </html>
  );
}

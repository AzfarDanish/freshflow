import type { Metadata } from "next";
import "./globals.css";
import OperationsWorkspace from "./operations/OperationsWorkspace";

export const metadata: Metadata = {
  title: "FreshFlow | Inventory operations",
  description: "A public hackathon preview for exploring FreshFlow grocery operations with Owner and Staff testing profiles.",
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

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreshFlow | Inventory actions",
  description: "Synthetic expiry-risk and staff-action demo for small grocers.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

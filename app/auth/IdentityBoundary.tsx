"use client";
import { useUser, UserButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import OperationsWorkspace from "../operations/OperationsWorkspace";

export default function IdentityBoundary({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const path = usePathname();
  if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) return <main className="identity-landing">{children}</main>;
  if (!isLoaded) return <main className="identity-landing"><h1>FreshFlow</h1><p>Loading secure session…</p></main>;
  if (!isSignedIn) return <main className="identity-landing">
    <div className="brand-mark" aria-hidden="true">F</div><h1>FreshFlow</h1>
    <p>Inventory exceptions. Clear decisions. Accountable action.</p>
    <p>Work with your real stock, supplier receipts, and staff tasks in a private business workspace.</p>
    <div className="toolbar"><Link className="btn btn-primary" href="/sign-in">Sign in</Link><Link className="btn btn-secondary" href="/sign-up">Create an account</Link></div>
    <p className="field-hint">Creating an account does not grant access to business data. An Owner must authorize membership.</p>
  </main>;
  return <><div className="identity-account"><UserButton /></div><OperationsWorkspace>{children}</OperationsWorkspace></>;
}

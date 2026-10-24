"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OPERATIONS, operationForPath } from "@/src/lib/operation-navigation";
import type { LucideIcon } from "lucide-react";
import { canAccessOperation } from "@/src/lib/access-control";
import type { Role } from "@/src/lib/types";
import {
  Activity, BarChart3, ClipboardList, Database, FileText, Gauge, Leaf, Package, Settings2, Sparkles,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  overview: Gauge, decisions: Sparkles, tasks: ClipboardList, activity: Activity,
  invoices: FileText, inventory: Package, insights:BarChart3, settings: Settings2,
};

export function Sidebar({ counts, storageLabel, locked, role }: { counts: Partial<Record<string, number>>; storageLabel: string; locked: boolean; role: Role }) {
  const active = operationForPath(usePathname())?.id;
  return (
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="FreshFlow overview" aria-disabled={locked} tabIndex={locked ? -1 : undefined} onClick={(event) => { if (locked) event.preventDefault(); }}>
        <span className="brand-mark"><Leaf aria-hidden="true" /></span>
        <span className="brand-name">FreshFlow</span>
      </Link>
      <nav className="side-nav" aria-label="Main navigation">
        <div className="nav-label">Operations</div>
        <ul>
          {OPERATIONS.filter(({ id }) => canAccessOperation(role, id)).map(({ id, label, href }) => {
            const Icon = icons[id];
            return (
            <li key={id}>
              <Link className={`nav-item ${active === id ? "active" : ""}`} href={href} aria-current={active === id ? "page" : undefined} aria-disabled={locked} tabIndex={locked ? -1 : undefined} onClick={(event) => { if (locked) event.preventDefault(); }}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {counts[id] ? <span className="nav-count" aria-label={`${counts[id]} need attention`}>{counts[id]}</span> : null}
              </Link>
            </li>
          ); })}
        </ul>
      </nav>
      <div className="side-footer">
        <Database aria-hidden="true" />
        <span>{storageLabel}</span>
      </div>
    </aside>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity, ClipboardList, Database, FileText, Gauge, Leaf, Package, Settings2, Sparkles,
} from "lucide-react";

export const NAV_SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "decisions", label: "Decisions", icon: Sparkles },
  { id: "tasks", label: "Staff tasks", icon: ClipboardList },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "invoices", label: "Invoice intake", icon: FileText },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "settings", label: "Settings & data", icon: Settings2 },
];

const ACTIVATION_OFFSET = 140;

function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) {
        setActive(ids[ids.length - 1]);
        return;
      }
      let current = ids[0];
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= ACTIVATION_OFFSET) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);
  return active;
}

const SECTION_IDS = NAV_SECTIONS.map((section) => section.id);

export function Sidebar({ counts, storageLabel }: { counts: Partial<Record<string, number>>; storageLabel: string }) {
  const active = useActiveSection(SECTION_IDS);
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="FreshFlow overview">
        <span className="brand-mark"><Leaf aria-hidden="true" /></span>
        <span className="brand-name">FreshFlow</span>
      </a>
      <nav className="side-nav" aria-label="Main navigation">
        <div className="nav-label">Operations</div>
        <ul>
          {NAV_SECTIONS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <a className={`nav-item ${active === id ? "active" : ""}`} href={`#${id}`} aria-current={active === id ? "location" : undefined}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {counts[id] ? <span className="nav-count" aria-label={`${counts[id]} need attention`}>{counts[id]}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="side-footer">
        <Database aria-hidden="true" />
        <span>{storageLabel}</span>
      </div>
    </aside>
  );
}

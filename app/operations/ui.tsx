import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type Tone = "danger" | "warning" | "success" | "info" | "neutral";

export function Section({
  id,
  icon: Icon,
  title,
  description,
  meta,
  actions,
  children,
  className = "",
}: {
  id?: string;
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} className={`panel ${className}`} aria-labelledby={headingId}>
      <header className="panel-head">
        <div className="panel-heading">
          <h2 className="panel-title" id={headingId}>
            {Icon && <Icon aria-hidden="true" />}
            {title}
            {meta !== undefined && <span className="panel-count">{meta}</span>}
          </h2>
          {description && <p className="panel-subtitle">{description}</p>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

export function LoadingRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="loading-panel" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton loading-line" key={index} />
      ))}
    </div>
  );
}

import {
  Activity, ArrowRight, Check, CheckCircle2, ClipboardCheck, FileText,
  Package, Pencil, RotateCcw, SlidersHorizontal, XCircle,
} from "lucide-react";
import type { ActivityEvent, Recommendation, StaffTask } from "@/src/lib/types";
import type { Role } from "@/src/lib/types";
import { TASK_PROGRESS_LABELS } from "@/src/lib/types";
import {
  activityActorLabel, batchRisk, dateLabel, dateTimeLabel, taskInventorySummary,
} from "@/src/lib/operations-view";
import type { InventoryRow } from "@/src/lib/operations-view";
import { EmptyState, StatusBadge } from "./ui";
import type { Tone } from "./ui";

export type { Role } from "@/src/lib/types";

const recommendationTone: Record<Recommendation["status"], Tone> = {
  pending: "warning",
  approved: "success",
  rejected: "neutral",
};

const recommendationLabel: Record<Recommendation["status"], string> = {
  pending: "Awaiting decision",
  approved: "Approved",
  rejected: "Rejected",
};

export function ExpiryWatchTable({
  groups,
  referenceDate,
  thresholdDays,
}: {
  groups: { key: string; title: string; emptyText: string; rows: InventoryRow[] }[];
  referenceDate: string;
  thresholdDays: number;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table expiry-table">
        <caption className="sr-only">Expiry watchlist, grouped by expired and approaching expiry</caption>
        <thead>
          <tr><th scope="col">Product</th><th scope="col">Batch</th><th scope="col" className="num">Quantity</th><th scope="col">Expiry</th><th scope="col">Status</th></tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr className="group-row">
              <th scope="colgroup" colSpan={5}>{group.title} <span className="subhead-count">{group.rows.length}</span></th>
            </tr>
            {group.rows.length ? group.rows.map(({ product, batch }) => {
              const risk = batchRisk(referenceDate, batch.expiryDate, thresholdDays);
              return (
                <tr key={`${product.id}-${batch.id}`}>
                  <td data-label="Product"><div className="cell-primary">{product.name}</div><div className="cell-secondary">{product.sku} · {product.category}</div></td>
                  <td data-label="Batch" className="mono">{batch.id}</td>
                  <td data-label="Quantity" className="num mono">{batch.quantity} {product.unit}</td>
                  <td data-label="Expiry">{dateLabel(batch.expiryDate)}</td>
                  <td data-label="Status"><StatusBadge tone={risk.tone}>{risk.label}</StatusBadge></td>
                </tr>
              );
            }) : (
              <tr className="group-empty"><td colSpan={5}>{group.emptyText}</td></tr>
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function RecommendationCard({
  recommendation,
  role,
  busy,
  onApprove,
  onReject,
}: {
  recommendation: Recommendation;
  role: Role;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className={`list-item recommendation ${recommendation.status === "pending" ? "is-pending" : ""}`}>
      <div className="item-top">
        <div className="item-heading">
          <h3 className="item-title">{recommendation.productName}</h3>
          <div className="item-meta mono">{recommendation.sku} · Batch {recommendation.batchId} · {recommendation.quantity} {recommendation.unit} · Expires {dateLabel(recommendation.expiryDate)}</div>
        </div>
        <StatusBadge tone={recommendationTone[recommendation.status]}>{recommendationLabel[recommendation.status]}</StatusBadge>
      </div>
      <dl className="detail-list">
        <div><dt>Rule</dt><dd>{recommendation.explanation}</dd></div>
        <div><dt>Suggested action</dt><dd className="suggested"><ArrowRight aria-hidden="true" />{recommendation.suggestedAction}</dd></div>
      </dl>
      {recommendation.status === "pending" && role === "owner" && (
        <div className="item-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={onApprove} disabled={busy}><Check aria-hidden="true" />Approve &amp; assign</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReject} disabled={busy}><XCircle aria-hidden="true" />Reject</button>
        </div>
      )}
      {recommendation.status === "pending" && role === "staff" && (
        <p className="item-note">Awaiting manager decision. Switch to Manager view to approve or reject.</p>
      )}
      {recommendation.status !== "pending" && (
        <p className="item-note">
          {recommendationLabel[recommendation.status]}
          {recommendation.decisionBy ? ` by ${recommendation.decisionBy}` : ""}
          {recommendation.decisionAt ? ` · ${dateTimeLabel(recommendation.decisionAt)}` : ""}
        </p>
      )}
    </article>
  );
}

export function TaskRow({
  task,
  recommendation,
  busy,
  onComplete,
  onProgress,
}: {
  task: StaffTask;
  recommendation?: Recommendation;
  busy: boolean;
  onComplete: () => void;
  onProgress: () => void;
}) {
  const inventoryDetails = taskInventorySummary(task, recommendation);
  const open = task.status === "open";
  return (
    <article className="list-item task">
      <div className="item-top">
        <div className="item-heading">
          <h3 className="item-title">{task.title}</h3>
          {inventoryDetails && <div className="item-meta mono">{inventoryDetails}</div>}
        </div>
        <StatusBadge tone={open ? task.progressType === "blocked" ? "warning" : "info" : "success"}>{open ? task.progressType && task.progressType !== "not_started" ? TASK_PROGRESS_LABELS[task.progressType] : "Open" : "Completed"}</StatusBadge>
      </div>
      <p className="item-body">{task.instruction}</p>
      {task.progressNote && <p className="item-note">Progress note: {task.progressNote}</p>}
      <div className="task-foot">
        <span className="task-assignee">Assigned to <strong>{task.assignedTo}</strong>{task.completedAt ? ` · completed ${dateTimeLabel(task.completedAt)}` : ""}</span>
        {open && <div className="toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onProgress} disabled={busy}>Update progress</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onComplete} disabled={busy}><ClipboardCheck aria-hidden="true" />Report outcome</button>
        </div>}
      </div>
      {task.status === "completed" && task.outcome && (
        <div className="reported">
          <span className="reported-label">Reported outcome · stock quantity unchanged</span>
          {task.outcome}
          {task.outcomeExplanation && task.outcomeType !== "other" && <span className="reported-detail">{task.outcomeExplanation}</span>}
        </div>
      )}
    </article>
  );
}

function activityIcon(event: ActivityEvent) {
  switch (event.type) {
    case "approved": return <CheckCircle2 aria-hidden="true" />;
    case "rejected": return <XCircle aria-hidden="true" />;
    case "task_completed": return <Check aria-hidden="true" />;
    case "task_progress_updated": return <ClipboardCheck aria-hidden="true" />;
    case "inventory_added": return <Package aria-hidden="true" />;
    case "inventory_edited": return <Pencil aria-hidden="true" />;
    case "inventory_deleted": return <XCircle aria-hidden="true" />;
    case "settings_changed": return <SlidersHorizontal aria-hidden="true" />;
    case "demo_reset": return <RotateCcw aria-hidden="true" />;
    case "invoice_uploaded":
    case "invoice_proposal_edited":
    case "invoice_proposal_confirmed":
    case "invoice_proposal_discarded": return <FileText aria-hidden="true" />;
    default: return <Activity aria-hidden="true" />;
  }
}

export function ActivityList({ events }: { events: ActivityEvent[] }) {
  if (!events.length) return <EmptyState title="No activity recorded yet" />;
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li className="timeline-item" key={event.id}>
          <span className="timeline-icon">{activityIcon(event)}</span>
          <div className="timeline-content">
            <div className="timeline-head">
              <span className="timeline-title">{event.title}</span>
              <time dateTime={event.occurredAt}>{dateTimeLabel(event.occurredAt)}</time>
            </div>
            <p className="timeline-desc">{event.description}</p>
            <div className="timeline-meta">
              <span>{activityActorLabel(event.actor)}</span>
              {event.batchId && <span>Batch {event.batchId}</span>}
              {event.recommendationId && <span>Recommendation linked</span>}
              {event.taskId && <span title={event.taskId}>Task linked</span>}
              {event.invoiceId && <span>Invoice linked</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

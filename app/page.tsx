"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle, CalendarDays, Check, CheckCircle2, ClipboardList,
  Info, LoaderCircle, Package, Pencil, Plus, RefreshCw, RotateCcw, Search,
  Settings2, ShieldAlert, SlidersHorizontal, Sparkles, X, XCircle, Activity, Gauge,
} from "lucide-react";
import { BUSINESS_WORKSPACES, DEFAULT_BUSINESS_ID } from "@/src/lib/businesses";
import { TASK_OUTCOME_LABELS } from "@/src/lib/types";
import type { AppState, InventoryAction, InventoryBatch, Product, Recommendation, StaffTask, StateResponse, TaskOutcomeType } from "@/src/lib/types";
import {
  batchRisk, dateLabel, expiryGroups, filterInventory, inventoryRows, sortRecommendations,
  sortTasks, taskInventorySummary, workspaceHasOnlySyntheticRecords,
} from "@/src/lib/operations-view";
import type { InventoryFilter } from "@/src/lib/operations-view";
import { InvoiceIntakePanel } from "@/app/invoice-intake/InvoiceIntakePanel";
import type { InvoiceIntakePanelProps } from "@/app/invoice-intake/InvoiceIntakePanel";
import { Sidebar } from "@/app/operations/Sidebar";
import { EmptyState, LoadingRows, Section, StatusBadge } from "@/app/operations/ui";
import { ActivityList, ExpiryWatchTable, RecommendationCard, TaskRow } from "@/app/operations/workflow";
import type { Role } from "@/app/operations/workflow";

type ModalKind = "add" | "edit" | "approve" | "reject" | "complete" | "reset" | null;
type InventorySelection = { product: Product; batch: InventoryBatch };

const emptyState: AppState = {
  products: [], recommendations: [], tasks: [], activity: [], invoiceIntakes: [],
  settings: { thresholdDays: 3, demoDate: "" },
};

const DIALOG_TITLES: Record<Exclude<ModalKind, null>, string> = {
  add: "Add stock batch",
  edit: "Edit inventory record",
  approve: "Approve recommendation",
  reject: "Reject recommendation",
  complete: "Report task outcome",
  reset: "Reset sample data",
};

export default function HomePage() {
  const [response, setResponse] = useState<StateResponse | null>(null);
  const loadRequestId = useRef(0);
  const [businessId, setBusinessId] = useState(DEFAULT_BUSINESS_ID);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [role, setRole] = useState<Role>("owner");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(3);
  const [formError, setFormError] = useState("");
  const [assignee, setAssignee] = useState("Aina");
  const [rejectReason, setRejectReason] = useState("");
  const [outcomeType, setOutcomeType] = useState<TaskOutcomeType>("rotated");
  const [outcomeExplanation, setOutcomeExplanation] = useState("");
  const [selectedInventory, setSelectedInventory] = useState<InventorySelection | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [resetAcknowledged, setResetAcknowledged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const state = response?.state ?? emptyState;
  const businessName = response?.business.name ?? BUSINESS_WORKSPACES.find((business) => business.id === businessId)?.name ?? "this shop";
  const referenceDate = state.settings.demoDate;
  const thresholdDays = state.settings.thresholdDays;

  const loadState = useCallback(async (targetBusinessId: string) => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const query = new URLSearchParams({ businessId: targetBusinessId });
      const res = await fetch(`/api/state?${query}`, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not load the latest shop state.");
      if (requestId !== loadRequestId.current) return;
      setResponse(body as StateResponse);
      setThresholdDraft((body as StateResponse).state.settings.thresholdDays);
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      setLoadError(error instanceof Error ? error.message : "Could not load the latest shop state.");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadState(businessId); }, [businessId, loadState]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeModal = useCallback(() => {
    setModal(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!modal) return;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button[data-autofocus]");
    (first ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        closeModal();
      }
      if (event.key === "Tab" && dialog) {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"));
        if (!focusable.length) return;
        const firstItem = focusable[0];
        const lastItem = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
        else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // Focus only when a dialog opens or changes, not on every busy toggle.
  }, [modal]);

  const sendAction = useCallback(async (action: InventoryAction, successMessage: string) => {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ businessId, action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "That action could not be saved.");
      setResponse(body as StateResponse);
      setThresholdDraft((body as StateResponse).state.settings.thresholdDays);
      setModal(null);
      setFormError("");
      setToastError(false);
      setToast(successMessage);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "That action could not be saved.";
      setActionError(message);
      setFormError(message);
      setToastError(true);
      setToast(message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [businessId]);

  const runInvoiceRequest = useCallback(async (request: () => Promise<Response>) => {
    setBusy(true);
    setActionError("");
    try {
      const res = await request();
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Invoice action could not be saved.");
      setResponse(body as StateResponse);
      setToastError(false);
      return body as StateResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoice action could not be saved.";
      setActionError(message);
      setToastError(true);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const uploadInvoice = useCallback(async (file: File) => {
    const form = new FormData();
    form.set("businessId", businessId);
    form.set("file", file);
    await runInvoiceRequest(() => fetch("/api/invoices", { method: "POST", body: form, headers: { Accept: "application/json" } }));
  }, [businessId, runInvoiceRequest]);

  const postInvoiceAction = useCallback((action: InventoryAction) => runInvoiceRequest(() => fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ businessId, action }),
  })), [businessId, runInvoiceRequest]);

  const saveInvoiceProposal = useCallback(async (intakeId: string, proposalId: string, fields: Parameters<InvoiceIntakePanelProps["onSaveProposal"]>[2]) => {
    const { matchedProductId, ...proposalFields } = fields;
    await postInvoiceAction({ type: "edit_invoice_proposal", payload: { intakeId, proposalId, fields: { ...proposalFields, matchedProductId: matchedProductId ?? undefined }, role } });
  }, [postInvoiceAction, role]);

  const confirmInvoiceProposal = useCallback(async (intakeId: string, proposalId: string, fields: Parameters<InvoiceIntakePanelProps["onConfirmProposal"]>[2]) => {
    const { matchMode, matchedProductId, ...proposalFields } = fields;
    await postInvoiceAction({ type: "confirm_invoice_proposal", payload: { intakeId, proposalId, fields: { ...proposalFields, matchedProductId: matchedProductId ?? undefined }, matchMode, role } });
  }, [postInvoiceAction, role]);

  const discardInvoiceProposal = useCallback(async (intakeId: string, proposalId: string) => {
    await postInvoiceAction({ type: "discard_invoice_proposal", payload: { intakeId, proposalId, role } });
  }, [postInvoiceAction, role]);

  const groups = useMemo(() => expiryGroups(state.products, referenceDate, thresholdDays), [state.products, referenceDate, thresholdDays]);
  const allRows = useMemo(() => inventoryRows(state.products), [state.products]);
  const filteredInventory = useMemo(
    () => filterInventory(allRows, inventoryQuery, inventoryFilter, referenceDate, thresholdDays),
    [allRows, inventoryQuery, inventoryFilter, referenceDate, thresholdDays],
  );
  const recommendations = useMemo(() => sortRecommendations(state.recommendations), [state.recommendations]);
  const tasks = useMemo(() => sortTasks(state.tasks), [state.tasks]);
  const activity = useMemo(() => [...state.activity].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [state.activity]);
  const pendingCount = state.recommendations.filter((recommendation) => recommendation.status === "pending").length;
  const openTaskCount = state.tasks.filter((task) => task.status === "open").length;
  const invoiceReviewCount = state.invoiceIntakes.filter((intake) => intake.status === "review").length;
  const resetAllowed = Boolean(response?.business.simulated) && workspaceHasOnlySyntheticRecords(state);
  const selectedTaskInventory = selectedTask
    ? taskInventorySummary(selectedTask, state.recommendations.find((item) => item.id === selectedTask.recommendationId))
    : "";
  const storageLabel = response
    ? response.persistenceMode === "replit_postgres" ? "Saved to Replit PostgreSQL" : "Test-only local storage"
    : "Connecting to storage…";

  function openModal(kind: ModalKind, recommendation?: Recommendation, task?: StaffTask, inventory?: InventorySelection) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError("");
    setFormError("");
    if (kind === "reject") setRejectReason("");
    if (kind === "reset") setResetAcknowledged(false);
    if (kind === "complete") {
      setOutcomeType("rotated");
      setOutcomeExplanation("");
    }
    setSelectedRecommendation(recommendation ?? null);
    setSelectedTask(task ?? null);
    setSelectedInventory(inventory ?? null);
    setModal(kind);
  }

  function changeBusiness(nextBusinessId: string) {
    loadRequestId.current += 1;
    setResponse(null);
    setBusinessId(nextBusinessId);
  }

  function submitInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get("quantity"));
    const productName = String(form.get("productName") ?? "").trim();
    const sku = String(form.get("sku") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const unit = String(form.get("unit") ?? "").trim();
    const expiryDate = String(form.get("expiryDate") ?? "");
    const batchId = String(form.get("batchId") ?? "").trim();
    if (!productName || !sku || !category || !unit || !batchId || !expiryDate || !Number.isFinite(quantity) || quantity <= 0 || (modal !== "edit" && !Number.isInteger(quantity))) {
      setFormError("Enter all fields and a positive quantity; manually added batches require a whole number.");
      return;
    }
    if (modal === "edit" && selectedInventory) {
      void sendAction({
        type: "edit_inventory",
        payload: { productId: selectedInventory.product.id, originalBatchId: selectedInventory.batch.id, batchId, productName, sku, category, unit, quantity, expiryDate },
      }, "Inventory record updated.");
      return;
    }
    void sendAction({ type: "add_inventory", payload: { productName, sku, category, unit, batchId, quantity, expiryDate } }, `Stock batch added to ${businessName}.`);
  }

  function approveRecommendation() {
    if (!selectedRecommendation) return;
    void sendAction({ type: "approve", payload: { recommendationId: selectedRecommendation.id, assignedTo: assignee.trim() || "Unassigned", role } }, "Recommendation approved; a staff task was created.");
  }
  function rejectRecommendation() {
    if (!selectedRecommendation) return;
    void sendAction({ type: "reject", payload: { recommendationId: selectedRecommendation.id, reason: rejectReason.trim() || undefined, role } }, "Recommendation rejected.");
  }
  function completeTask() {
    if (!selectedTask) return;
    if (outcomeType === "other" && outcomeExplanation.trim().length < 3) {
      setFormError("Explain the Other outcome in at least 3 characters.");
      return;
    }
    void sendAction({
      type: "complete_task",
      payload: { taskId: selectedTask.id, outcomeType, outcomeExplanation: outcomeExplanation.trim() || undefined, role },
    }, "Task completed with a staff-reported outcome.");
  }
  function changeThreshold() {
    void sendAction({ type: "set_threshold", payload: { thresholdDays: thresholdDraft } }, "Expiry threshold updated.");
  }

  const controlsLocked = busy || modal !== null;

  return <div className="shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Sidebar storageLabel={storageLabel} counts={{ decisions: pendingCount, tasks: openTaskCount, invoices: invoiceReviewCount }} />

    <main className="main" id="main-content" tabIndex={-1}>
      <header className="topbar">
        <div className="topbar-context">
          <span className="topbar-label">Workspace</span>
          <span className="topbar-value">{businessName}</span>
        </div>
        <div className="top-actions">
          <label className="control">
            <span className="control-label">Shop</span>
            <select value={businessId} onChange={(event) => changeBusiness(event.target.value)} disabled={controlsLocked}>
              {(response?.businesses ?? BUSINESS_WORKSPACES).map((business) => (
                <option key={business.id} value={business.id}>{business.name}</option>
              ))}
            </select>
          </label>
          <div className="control" role="group" aria-labelledby="role-view-label">
            <span className="control-label" id="role-view-label" title="Role views are simulated for this MVP. They are not sign-in or access control.">Role view · simulated</span>
            <div className="segmented">
              {(["owner", "staff"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={role === value} className={role === value ? "selected" : ""} onClick={() => setRole(value)} disabled={controlsLocked}>
                  {value === "owner" ? "Owner" : "Staff"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="page-header" id="overview">
        <div>
          <h1>Inventory operations</h1>
          <p className="page-meta">
            <span><CalendarDays aria-hidden="true" />Reference date <strong>{dateLabel(referenceDate)}</strong></span>
            <span>Expiry threshold <strong>{thresholdDays} days</strong></span>
            <a href="#workspace-data"><Info aria-hidden="true" />Sample data and simulated roles</a>
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void loadState(businessId)} disabled={loading || busy}><RefreshCw aria-hidden="true" className={loading ? "spin" : ""} />Refresh</button>
          <button type="button" className="btn btn-primary" onClick={() => openModal("add")} disabled={busy || loading || Boolean(loadError)}><Plus aria-hidden="true" />Add stock</button>
        </div>
      </div>

      {actionError && <div className="alert alert-danger" role="alert"><AlertTriangle aria-hidden="true" /><span>{actionError}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setActionError("")}>Dismiss</button></div>}

      {loadError ? <div className="alert alert-danger" role="alert"><AlertTriangle aria-hidden="true" /><span>{loadError}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadState(businessId)}><RefreshCw aria-hidden="true" />Retry</button></div> : <>
        <dl className="stats" aria-label="Today's summary">
          <div className="stat"><dt>Expired batches</dt><dd className={groups.expired.length ? "tone-danger" : ""}>{loading ? "—" : groups.expired.length}</dd><span className="stat-note">Shown separately from approaching</span></div>
          <div className="stat"><dt>Approaching expiry</dt><dd className={groups.approaching.length ? "tone-warning" : ""}>{loading ? "—" : groups.approaching.length}</dd><span className="stat-note">Within {thresholdDays} days</span></div>
          <div className="stat"><dt>Awaiting decision</dt><dd>{loading ? "—" : pendingCount}</dd><span className="stat-note">{state.recommendations.length} recommendations total</span></div>
          <div className="stat"><dt>Open staff tasks</dt><dd>{loading ? "—" : openTaskCount}</dd><span className="stat-note">{state.tasks.length} tasks total</span></div>
        </dl>

        <div className="grid-2">
          <Section icon={Gauge} title="Expiry watchlist" description={`Batches expired or due within ${thresholdDays} days of the reference date`} meta={loading ? undefined : groups.expired.length + groups.approaching.length}>
            {loading ? <LoadingRows label="Loading expiry watchlist" /> : <ExpiryWatchTable
              referenceDate={referenceDate}
              thresholdDays={thresholdDays}
              groups={[
                { key: "expired", title: "Expired", emptyText: "No expired batches", rows: groups.expired },
                { key: "approaching", title: "Approaching expiry", emptyText: "No batches approaching expiry", rows: groups.approaching },
              ]}
            />}
          </Section>

          <Section id="decisions" icon={Sparkles} title="Decisions" description={role === "owner" ? "Review each rule-based recommendation, then approve or reject" : "Owner decisions on rule-based recommendations"} meta={loading ? undefined : `${pendingCount} pending`} className="scroll-panel">
            {loading ? <LoadingRows label="Loading recommendations" /> :
              recommendations.length ? <div className="list">{recommendations.map((recommendation) => <RecommendationCard key={recommendation.id} recommendation={recommendation} role={role} busy={busy} onApprove={() => openModal("approve", recommendation)} onReject={() => openModal("reject", recommendation)} />)}</div> :
              <EmptyState title="No recommendations">A batch inside the expiry threshold creates one.</EmptyState>}
          </Section>
        </div>

        <div className="grid-2">
          <Section id="tasks" icon={ClipboardList} title="Staff tasks" description="Created when an owner approves a recommendation; staff report the outcome" meta={loading ? undefined : `${openTaskCount} open`} className="scroll-panel">
            {loading ? <LoadingRows label="Loading staff tasks" /> :
              tasks.length ? <div className="list">{tasks.map((task) => <TaskRow key={task.id} task={task} recommendation={state.recommendations.find((item) => item.id === task.recommendationId)} role={role} busy={busy} onComplete={() => openModal("complete", undefined, task)} />)}</div> :
              <EmptyState title="No staff tasks">Approve a pending recommendation to create one.</EmptyState>}
          </Section>

          <Section id="activity" icon={Activity} title="Activity" description="Newest first · decisions, tasks, inventory and invoice events" meta={loading ? undefined : activity.length} className="scroll-panel">
            {loading ? <LoadingRows label="Loading activity" /> : <ActivityList events={activity} />}
          </Section>
        </div>

        <div id="invoices" className="anchor-section">
          <InvoiceIntakePanel
            businessId={businessId}
            businessName={businessName}
            role={role}
            products={state.products}
            intakes={state.invoiceIntakes}
            busy={busy || loading}
            onUpload={uploadInvoice}
            onSaveProposal={saveInvoiceProposal}
            onConfirmProposal={confirmInvoiceProposal}
            onDiscardProposal={discardInvoiceProposal}
          />
        </div>

        <Section
          id="inventory"
          icon={Package}
          title="Inventory"
          description={`All product batches for ${businessName}`}
          meta={loading ? undefined : `${filteredInventory.length} of ${allRows.length}`}
          actions={<div className="toolbar">
            <label className="search-field">
              <Search aria-hidden="true" />
              <span className="sr-only">Search inventory</span>
              <input type="search" value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} placeholder="Search product, SKU or batch" />
            </label>
            <label className="select-field">
              <span className="sr-only">Filter by expiry status</span>
              <select value={inventoryFilter} onChange={(event) => setInventoryFilter(event.target.value as InventoryFilter)}>
                <option value="all">All statuses</option>
                <option value="expired">Expired</option>
                <option value="approaching">Approaching</option>
                <option value="safe">No current risk</option>
              </select>
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openModal("add")} disabled={busy || loading}><Plus aria-hidden="true" />Add stock</button>
          </div>}
        >
          {loading ? <LoadingRows label="Loading inventory" rows={4} /> :
            filteredInventory.length ? <div className="table-scroll">
              <table className="data-table">
                <caption className="sr-only">Inventory batches</caption>
                <thead><tr><th scope="col">Product</th><th scope="col">Batch</th><th scope="col" className="num">Quantity</th><th scope="col">Expiry</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {filteredInventory.map(({ product, batch }) => {
                    const risk = batchRisk(referenceDate, batch.expiryDate, thresholdDays);
                    return <tr key={`${product.id}-${batch.id}`}>
                      <td data-label="Product"><div className="cell-primary">{product.name}</div><div className="cell-secondary">{product.sku} · {product.category}</div></td>
                      <td data-label="Batch" className="mono">{batch.id}</td>
                      <td data-label="Quantity" className="num mono">{batch.quantity} {product.unit}</td>
                      <td data-label="Expiry">{dateLabel(batch.expiryDate)}</td>
                      <td data-label="Status"><StatusBadge tone={risk.tone}>{risk.label}</StatusBadge></td>
                      <td className="row-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => openModal("edit", undefined, undefined, { product, batch })} disabled={busy} aria-label={`Edit ${product.name} batch ${batch.id}`}><Pencil aria-hidden="true" />Edit</button></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div> : allRows.length ? <EmptyState title="No matching batches">Adjust the search or status filter.</EmptyState> : <EmptyState title="No inventory yet">Add a stock batch or confirm an invoice line to get started.</EmptyState>}
        </Section>

        <Section id="settings" icon={Settings2} title="Settings & data" description="Expiry rule, workspace information and data reset">
          <div className="settings-grid">
            <div className="settings-block">
              <h3 className="block-title"><SlidersHorizontal aria-hidden="true" />Expiry rule</h3>
              <p className="block-text">A batch is approaching when it expires on or after the reference date and within the threshold. Expired stock is listed separately and is not counted as approaching.</p>
              <div className="threshold">
                <label htmlFor="threshold-days" className="field-label">Threshold</label>
                <input id="threshold-days" type="range" min="1" max="14" value={thresholdDraft} onChange={(event) => setThresholdDraft(Number(event.target.value))} disabled={busy} />
                <output htmlFor="threshold-days" className="threshold-output">{thresholdDraft} {thresholdDraft === 1 ? "day" : "days"}</output>
                <button type="button" className="btn btn-secondary btn-sm" onClick={changeThreshold} disabled={busy || thresholdDraft === thresholdDays}>Save rule</button>
              </div>
            </div>

            <div className="settings-block" id="workspace-data">
              <h3 className="block-title"><Info aria-hidden="true" />About this workspace</h3>
              <ul className="facts">
                <li><strong>Sample shops.</strong> Seed products, batches and staff names are synthetic. Uploaded invoices and owner-confirmed batches are stored as real records.</li>
                <li><strong>Simulated roles.</strong> The shop selector and Owner/Staff view are not sign-in or access control.</li>
                <li><strong>Reference date.</strong> Expiry is calculated against the configured date shown above, not today&apos;s calendar date.</li>
                <li><strong>Storage.</strong> {storageLabel}. There is no live POS or stock-system sync; completing a task never changes quantities.</li>
              </ul>
            </div>
          </div>

          <div className="danger-zone">
            <div>
              <h3 className="block-title"><ShieldAlert aria-hidden="true" />Reset sample data</h3>
              <p className="block-text">
                {resetAllowed
                  ? `Restores ${businessName} to its starting sample data and clears its activity history. Other shops are not affected.`
                  : `Unavailable for ${businessName}: it contains uploaded invoices or other non-sample records, which reset never removes.`}
              </p>
            </div>
            <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => openModal("reset")} disabled={busy || loading || !resetAllowed}><RotateCcw aria-hidden="true" />Reset sample data…</button>
          </div>
        </Section>
      </>}
    </main>

    {modal && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeModal(); }}>
      <div className={`dialog ${modal === "reset" ? "dialog-danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-intro" ref={dialogRef} tabIndex={-1}>
        <div className="dialog-head">
          <div>
            <h2 id="dialog-title">{DIALOG_TITLES[modal]}</h2>
            <p className="dialog-intro" id="dialog-intro">{modal === "add" ? `Add a product batch to ${businessName}.` : modal === "edit" ? "Update this product and batch. Related expiry risks are recalculated." : modal === "approve" ? "Approval creates one staff task linked to this recommendation." : modal === "reject" ? "Record the owner decision. No task is created." : modal === "complete" ? "Record what staff reported. Completing a task does not adjust stock quantity." : `This affects ${businessName} only.`}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={closeModal} disabled={busy}><X aria-hidden="true" /></button>
        </div>

        {(modal === "add" || modal === "edit") && <form onSubmit={submitInventory} noValidate>
          <div className="form-grid">
            <div className="field"><label htmlFor="productName">Product name</label><input id="productName" name="productName" required defaultValue={selectedInventory?.product.name} placeholder="e.g. Fresh milk" /></div>
            <div className="field"><label htmlFor="sku">SKU</label><input id="sku" name="sku" required defaultValue={selectedInventory?.product.sku} placeholder="e.g. MILK" /></div>
            <div className="field"><label htmlFor="category">Category</label><input id="category" name="category" required defaultValue={selectedInventory?.product.category} placeholder="e.g. Dairy" /></div>
            <div className="field"><label htmlFor="unit">Unit</label><input id="unit" name="unit" required defaultValue={selectedInventory?.product.unit} placeholder="e.g. bottles" /></div>
            <div className="field"><label htmlFor="batchId">Batch ID</label><input id="batchId" name="batchId" required defaultValue={selectedInventory?.batch.id} placeholder="e.g. MILK-003" /></div>
            <div className="field"><label htmlFor="quantity">Quantity</label><input id="quantity" name="quantity" required type="number" min={modal === "edit" ? "0.000001" : "1"} max="100000" step={modal === "edit" ? "any" : "1"} inputMode="decimal" defaultValue={selectedInventory?.batch.quantity} placeholder="24" /></div>
            <div className="field full"><label htmlFor="expiryDate">Expiry date</label><input id="expiryDate" name="expiryDate" required type="date" defaultValue={selectedInventory?.batch.expiryDate} /></div>
          </div>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : modal === "edit" ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}{modal === "edit" ? "Save changes" : "Add batch"}</button></div>
        </form>}

        {modal === "approve" && <div>
          {selectedRecommendation && <div className="summary-box"><div className="summary-title">{selectedRecommendation.productName}</div><div className="summary-meta mono">{selectedRecommendation.quantity} {selectedRecommendation.unit} · Batch {selectedRecommendation.batchId} · Expires {dateLabel(selectedRecommendation.expiryDate)}</div><p>{selectedRecommendation.suggestedAction}</p></div>}
          <div className="field"><label htmlFor="assignee">Assign task to</label><select id="assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option>Aina</option><option>Ravi</option><option>Mei Ling</option><option>Unassigned</option></select><span className="field-hint">Staff names are sample team members.</span></div>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" onClick={approveRecommendation} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}Approve &amp; create task</button></div>
        </div>}

        {modal === "reject" && <div>
          {selectedRecommendation && <div className="summary-box"><div className="summary-title">{selectedRecommendation.productName}</div><div className="summary-meta mono">Batch {selectedRecommendation.batchId} · Expires {dateLabel(selectedRecommendation.expiryDate)}</div></div>}
          <div className="field"><label htmlFor="rejectReason">Reason <span className="optional">(optional)</span></label><textarea id="rejectReason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Added to the activity record" /></div>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button><button type="button" className="btn btn-danger" onClick={rejectRecommendation} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <XCircle aria-hidden="true" />}Reject recommendation</button></div>
        </div>}

        {modal === "complete" && <div>
          <div className="summary-box"><div className="summary-title">{selectedTask?.title}</div>{selectedTaskInventory && <div className="summary-meta mono">{selectedTaskInventory}</div>}<p>{selectedTask?.instruction}</p><div className="summary-meta">Assigned to {selectedTask?.assignedTo}</div></div>
          <div className="field"><label htmlFor="outcomeType">Staff-reported outcome</label><select id="outcomeType" value={outcomeType} onChange={(event) => { setOutcomeType(event.target.value as TaskOutcomeType); setOutcomeExplanation(""); }}>{Object.entries(TASK_OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {outcomeType === "other" && <div className="field"><label htmlFor="outcomeExplanation">Explain the Other outcome</label><textarea id="outcomeExplanation" value={outcomeExplanation} onChange={(event) => setOutcomeExplanation(event.target.value)} minLength={3} maxLength={500} required placeholder="Describe what staff reported" /></div>}
          <p className="field-hint"><Info aria-hidden="true" />This records a report only. No stock quantity is adjusted.</p>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" onClick={completeTask} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}Save outcome</button></div>
        </div>}

        {modal === "reset" && <div>
          <div className="alert alert-danger compact"><AlertTriangle aria-hidden="true" /><span>All products, batches, recommendations, tasks and activity for <strong>{businessName}</strong> will be replaced with the starting sample data. This cannot be undone. The server refuses the reset if the shop contains uploaded invoices or other non-sample records.</span></div>
          <label className="checkbox"><input type="checkbox" checked={resetAcknowledged} onChange={(event) => setResetAcknowledged(event.target.checked)} />I understand that {businessName}&apos;s current sample data and history will be cleared.</label>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy} data-autofocus>Keep current data</button><button type="button" className="btn btn-danger" onClick={() => void sendAction({ type: "reset" }, `${businessName} reset to its starting sample data.`)} disabled={busy || !resetAcknowledged}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <RotateCcw aria-hidden="true" />}Reset sample data</button></div>
        </div>}
      </div>
    </div>}

    <div className="toast-region" aria-live="polite">
      {toast && <div className={`toast ${toastError ? "error" : ""}`} role="status">{toastError ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}{toast}</div>}
    </div>
  </div>;
}

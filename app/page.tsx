"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, Check, CheckCircle2,
  ChevronDown, CircleHelp, ClipboardList, Clock3, Leaf, LoaderCircle,
  Package, Pencil, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles,
  X, XCircle,
} from "lucide-react";
import { BUSINESS_WORKSPACES, DEFAULT_BUSINESS_ID } from "@/src/lib/businesses";
import type { ActivityEvent, AppState, InventoryAction, InventoryBatch, Product, Recommendation, StaffTask, StateResponse } from "@/src/lib/types";

type Role = "owner" | "staff";
type ModalKind = "add" | "edit" | "approve" | "reject" | "complete" | "reset" | null;
type InventorySelection = { product: Product; batch: InventoryBatch };
type InventoryFilter = "all" | "expired" | "approaching" | "safe";

const emptyState: AppState = {
  products: [], recommendations: [], tasks: [], activity: [],
  settings: { thresholdDays: 3, demoDate: "" },
};

function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("en-MY", { day: "numeric", month: "short" })} · ${date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}`;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

function productBatches(products: Product[], demoDate: string, threshold: number) {
  const expired: { product: Product; batch: Product["batches"][number] }[] = [];
  const approaching: { product: Product; batch: Product["batches"][number] }[] = [];
  products.forEach((product) => product.batches.forEach((batch) => {
    const days = daysBetween(demoDate, batch.expiryDate);
    if (days < 0) expired.push({ product, batch });
    else if (days <= threshold) approaching.push({ product, batch });
  }));
  const byExpiry = (a: (typeof expired)[number], b: (typeof expired)[number]) => a.batch.expiryDate.localeCompare(b.batch.expiryDate);
  return { expired: expired.sort(byExpiry), approaching: approaching.sort(byExpiry) };
}

function Panel({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`panel ${className}`}>{children}</section>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="table-empty">{children}</div>;
}

function BatchRows({ items, demoDate }: { items: ReturnType<typeof productBatches>["expired"]; demoDate: string }) {
  if (!items.length) return <Empty>No batches in this group right now.</Empty>;
  return <>{items.map(({ product, batch }) => {
    const remaining = daysBetween(demoDate, batch.expiryDate);
    return <div className="stock-row" key={batch.id}>
      <div><div className="product-name">{product.name}</div><div className="product-meta">{product.sku} · {product.category}</div></div>
      <div className="batch-date">{dateLabel(batch.expiryDate)}</div>
      <div className="qty">{batch.quantity} {product.unit}</div>
      <div><span className={`risk-tag ${remaining < 0 ? "risk-expired" : "risk-approaching"}`}>{remaining < 0 ? "Expired" : `${remaining}d left`}</span></div>
    </div>;
  })}</>;
}

function activityIcon(event: ActivityEvent) {
  switch (event.type) {
    case "approved": return <CheckCircle2 size={14} />;
    case "rejected": return <XCircle size={14} />;
    case "task_completed": return <Check size={14} />;
    case "inventory_added": return <Package size={14} />;
    case "inventory_edited": return <Pencil size={14} />;
    case "settings_changed": return <SlidersHorizontal size={14} />;
    case "demo_reset": return <RotateCcw size={14} />;
    default: return <Activity size={14} />;
  }
}

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
  const [outcome, setOutcome] = useState("");
  const [selectedInventory, setSelectedInventory] = useState<InventorySelection | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");

  const state = response?.state ?? emptyState;
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
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  const batches = useMemo(() => productBatches(state.products, state.settings.demoDate, state.settings.thresholdDays), [state.products, state.settings.demoDate, state.settings.thresholdDays]);
  const pendingRecommendations = state.recommendations.filter((recommendation) => recommendation.status === "pending");
  const visibleRecommendations = [...state.recommendations].sort((a, b) => {
    const pendingOrder = Number(b.status === "pending") - Number(a.status === "pending");
    if (pendingOrder) return pendingOrder;
    const milkOrder = Number(b.batchId === "MILK-001") - Number(a.batchId === "MILK-001");
    if (milkOrder) return milkOrder;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const openTasks = state.tasks.filter((task) => task.status === "open");
  const totalUnits = state.products.reduce((sum, product) => sum + product.batches.reduce((subtotal, batch) => subtotal + batch.quantity, 0), 0);
  const activity = [...state.activity].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const inventoryRows = state.products.flatMap((product) =>
    product.batches.map((batch) => ({ product, batch })),
  );
  const filteredInventory = inventoryRows.filter(({ product, batch }) => {
    const daysUntilExpiry = daysBetween(state.settings.demoDate, batch.expiryDate);
    const riskMatches =
      inventoryFilter === "all" ||
      (inventoryFilter === "expired" && daysUntilExpiry < 0) ||
      (inventoryFilter === "approaching" &&
        daysUntilExpiry >= 0 &&
        daysUntilExpiry <= state.settings.thresholdDays) ||
      (inventoryFilter === "safe" &&
        daysUntilExpiry > state.settings.thresholdDays);
    const haystack = [
      product.name,
      product.sku,
      product.category,
      product.unit,
      batch.id,
      batch.expiryDate,
    ].join(" ").toLowerCase();
    return riskMatches && haystack.includes(inventoryQuery.trim().toLowerCase());
  });

  function openModal(kind: ModalKind, recommendation?: Recommendation, task?: StaffTask, inventory?: InventorySelection) {
    setActionError("");
    setFormError("");
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
    if (!productName || !sku || !category || !unit || !batchId || !expiryDate || !Number.isInteger(quantity) || quantity < 1) {
      setFormError("Enter all fields and a whole-number quantity greater than zero.");
      return;
    }
    if (modal === "edit" && selectedInventory) {
      void sendAction({
        type: "edit_inventory",
        payload: {
          productId: selectedInventory.product.id,
          originalBatchId: selectedInventory.batch.id,
          batchId,
          productName,
          sku,
          category,
          unit,
          quantity,
          expiryDate,
        },
      }, "Inventory batch updated.");
      return;
    }
    void sendAction({ type: "add_inventory", payload: { productName, sku, category, unit, batchId, quantity, expiryDate } }, "Stock batch added to this demo shop.");
  }

  function approveRecommendation() {
    if (!selectedRecommendation) return;
    void sendAction({ type: "approve", payload: { recommendationId: selectedRecommendation.id, assignedTo: assignee.trim() || "Unassigned", role } }, "Recommendation approved; a staff task is ready.");
  }
  function rejectRecommendation() {
    if (!selectedRecommendation) return;
    void sendAction({ type: "reject", payload: { recommendationId: selectedRecommendation.id, reason: rejectReason.trim() || undefined, role } }, "Recommendation rejected.");
  }
  function completeTask() {
    if (!selectedTask) return;
    if (outcome.trim().length < 3) {
      setFormError("Add a short staff-reported outcome before completing the task.");
      return;
    }
    void sendAction({ type: "complete_task", payload: { taskId: selectedTask.id, outcome: outcome.trim(), role } }, "Task marked complete with a staff-reported outcome.");
  }
  function changeThreshold() {
    void sendAction({ type: "set_threshold", payload: { thresholdDays: thresholdDraft } }, "Expiry threshold updated.");
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Leaf size={18} strokeWidth={2.5} /></span><span className="brand-name">fresh<span>flow</span></span></div>
      <nav aria-label="Main navigation">
        <div className="nav-label">Shop operations</div>
        <button className="nav-item active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Activity /><span>Overview</span></button>
        <button className="nav-item" onClick={() => document.getElementById("inventory-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Package /><span>Inventory</span></button>
        <button className="nav-item" onClick={() => document.getElementById("tasks-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}><ClipboardList /><span>Staff tasks</span></button>
      </nav>
      <div className="side-bottom">
        <div className="demo-note"><strong>SIMULATION MODE</strong>All products, events and reported outcomes shown here are synthetic. No live stock system is connected.</div>
        <div className="side-version">FRESHFLOW · DEMO 01</div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="crumb">Operations <span> / </span> <b>Today</b></div>
        <div className="top-actions">
          <div className="business-select">
            <label htmlFor="business">Demo shop</label>
            <select
              id="business"
              value={businessId}
              onChange={(event) => changeBusiness(event.target.value)}
              disabled={busy || modal !== null}
            >
              {(response?.businesses ?? BUSINESS_WORKSPACES).map((business) => (
                <option key={business.id} value={business.id}>{business.name}</option>
              ))}
            </select>
          </div>
          <div className="mode-pill" title={response?.persistenceMode === "supabase" ? "Persisted with Supabase" : "Stored in local demo mode"}><span className="mode-dot" />{response?.persistenceMode === "supabase" ? "Supabase" : "Local demo"}</div>
          <div className="role-select"><label htmlFor="role">Demo role</label><select id="role" value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="owner">Owner</option><option value="staff">Staff</option></select><ChevronDown size={12} /></div>
        </div>
      </header>

      <div className="page-heading">
        <div><div className="eyebrow">Daily shop pulse</div><h1>Inventory operations</h1></div>
        <div className="date-meta"><Clock3 />Demo date <strong>{dateLabel(state.settings.demoDate)}</strong></div>
      </div>

      <div className="notice"><CircleHelp size={15} /><span><strong>Synthetic demo data.</strong> Shop and role switching are demonstration conveniences—not authentication or secure data isolation. Records and events are simulated.</span><span className="notice-right">NO LIVE INVENTORY</span></div>

      {loadError ? <div className="error-card" role="alert">{loadError}<button className="btn btn-small" onClick={() => void loadState(businessId)} style={{ marginLeft: 12 }}><RefreshCw size={13} /> Retry</button></div> : <>
        <div className="metrics">
          <div className="metric alert"><div className="metric-label">Expired batches</div><div className="metric-number">{loading ? "—" : batches.expired.length}<small>separate from approaching</small></div></div>
          <div className="metric warn"><div className="metric-label">Approaching</div><div className="metric-number">{loading ? "—" : batches.approaching.length}<small>within {state.settings.thresholdDays} days</small></div></div>
          <div className="metric"><div className="metric-label">Open staff tasks</div><div className="metric-number">{loading ? "—" : openTasks.length}<small>{state.tasks.length} total</small></div></div>
          <div className="metric"><div className="metric-label">Units recorded</div><div className="metric-number">{loading ? "—" : totalUnits}<small>synthetic batches</small></div></div>
        </div>

        <div className="workspace">
          <div className="left-stack">
            <Panel id="inventory-panel">
              <div className="panel-head">
                <div><div className="panel-title"><Package />Stock by expiry</div><div className="panel-subtitle">Batch-level view · expiry groups are mutually exclusive</div></div>
                <div className="panel-actions"><button className="btn btn-primary btn-small" onClick={() => openModal("add")}><Plus />Add stock</button></div>
              </div>
              {loading ? <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line" /><div className="skeleton loading-line" /></div> :
              <div className="stock-wrap">
                <div className="table-divider" style={{ borderTop: 0 }}>Expired <span>{batches.expired.length} batches</span></div>
                <div className="stock-head"><span>Product / SKU</span><span>Expiry date</span><span>Quantity</span><span>Risk</span></div>
                <BatchRows items={batches.expired} demoDate={state.settings.demoDate} />
                <div className="table-divider" style={{ marginTop: 8 }}>Approaching expiry <span>{batches.approaching.length} batches</span></div>
                <div className="stock-head"><span>Product / SKU</span><span>Expiry date</span><span>Quantity</span><span>Risk</span></div>
                <BatchRows items={batches.approaching} demoDate={state.settings.demoDate} />
                {!state.products.length && <Empty>No products yet. Add a simulated stock batch to get started.</Empty>}
              </div>}
            </Panel>

            <Panel>
              <div className="panel-head inventory-management-head">
                <div>
                  <div className="panel-title"><Package />Inventory records</div>
                  <div className="panel-subtitle">All batches for {response?.business.name ?? "this demo shop"}</div>
                </div>
                <div className="inventory-controls">
                  <label className="inventory-search">
                    <Search size={14} />
                    <span className="sr-only">Search inventory</span>
                    <input
                      type="search"
                      value={inventoryQuery}
                      onChange={(event) => setInventoryQuery(event.target.value)}
                      placeholder="Search products or batches"
                    />
                  </label>
                  <label>
                    <span className="sr-only">Filter inventory</span>
                    <select
                      value={inventoryFilter}
                      onChange={(event) => setInventoryFilter(event.target.value as InventoryFilter)}
                    >
                      <option value="all">All stock</option>
                      <option value="expired">Expired</option>
                      <option value="approaching">Approaching</option>
                      <option value="safe">No current risk</option>
                    </select>
                  </label>
                </div>
              </div>
              {loading ? <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line" /></div> :
                filteredInventory.length ? <div className="inventory-table-wrap">
                  <div className="inventory-table-head">
                    <span>Product</span><span>Batch</span><span>Quantity</span><span>Expiry</span><span>Risk</span><span>Action</span>
                  </div>
                  {filteredInventory.map(({ product, batch }) => {
                    const days = daysBetween(state.settings.demoDate, batch.expiryDate);
                    const riskClass = days < 0 ? "risk-expired" : days <= state.settings.thresholdDays ? "risk-approaching" : "risk-safe";
                    const riskLabel = days < 0 ? "Expired" : days <= state.settings.thresholdDays ? `${days}d left` : "No current risk";
                    return <div className="inventory-table-row" key={`${product.id}-${batch.id}`}>
                      <div><b>{product.name}</b><small>{product.sku} · {product.category}</small></div>
                      <span className="batch-date">{batch.id}</span>
                      <span className="qty">{batch.quantity} {product.unit}</span>
                      <span className="batch-date">{dateLabel(batch.expiryDate)}</span>
                      <span><span className={`risk-tag ${riskClass}`}>{riskLabel}</span></span>
                      <button className="btn btn-small" onClick={() => openModal("edit", undefined, undefined, { product, batch })} disabled={busy}><Pencil />Edit</button>
                    </div>;
                  })}
                </div> : <Empty>{inventoryRows.length ? "No inventory matches these search and filter settings." : "This demo shop has no inventory yet. Add a batch to get started."}</Empty>}
            </Panel>

            <Panel>
              <div className="panel-head">
                <div><div className="panel-title"><SlidersHorizontal />Expiry rule</div><div className="panel-subtitle">Flag batches due within this many days</div></div>
                <div className="threshold"><input aria-label="Expiry threshold days" type="range" min="1" max="14" value={thresholdDraft} onChange={(event) => setThresholdDraft(Number(event.target.value))} /><span className="threshold-output">{thresholdDraft}d</span><button className="btn btn-small" onClick={changeThreshold} disabled={busy || thresholdDraft === state.settings.thresholdDays}>Save rule</button></div>
              </div>
              <div className="recommendation" style={{ paddingTop: 13, paddingBottom: 14 }}>
                <div className="explain-text">A batch is approaching when its expiry falls on or after the demo date and within the selected threshold. Expired stock is shown separately and is not counted as approaching.</div>
              </div>
            </Panel>
          </div>

          <div className="right-stack">
            <Panel>
              <div className="panel-head"><div><div className="panel-title"><Sparkles />Owner decisions</div><div className="panel-subtitle">{pendingRecommendations.length} awaiting a decision</div></div><span className="small-mono">SIMULATED</span></div>
              {loading ? <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line" /></div> :
              visibleRecommendations.length ? visibleRecommendations.map((recommendation) => <RecommendationCard key={recommendation.id} recommendation={recommendation} role={role} busy={busy} onApprove={() => openModal("approve", recommendation)} onReject={() => openModal("reject", recommendation)} />) :
              <div className="recommendation"><Empty>No recommendations yet. An approaching batch may create one.</Empty></div>}
            </Panel>

            <Panel id="tasks-panel">
              <div className="panel-head"><div><div className="panel-title"><ClipboardList />Staff work</div><div className="panel-subtitle">Approval creates a task; staff reports completion</div></div><span className="small-mono">{openTasks.length} OPEN</span></div>
              {loading ? <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line" /></div> :
              state.tasks.length ? <div className="tasks-list">{[...state.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((task) => <TaskRow key={task.id} task={task} role={role} busy={busy} onComplete={() => { setOutcome(""); openModal("complete", undefined, task); }} />)}</div> : <div className="recommendation"><Empty>No staff tasks. Approve a pending recommendation to create one.</Empty></div>}
            </Panel>

            <Panel>
              <div className="panel-head"><div><div className="panel-title"><Activity />Activity log</div><div className="panel-subtitle">Newest events first · simulated records</div></div><span className="small-mono">{activity.length} EVENTS</span></div>
              {loading ? <div className="loading-panel"><div className="skeleton loading-line" /><div className="skeleton loading-line" /></div> :
              activity.length ? <div className="activity">{activity.map((event) => <div className="event" key={event.id}><div className="event-title">{event.title}</div><div className="event-desc">{event.description}</div><div className="event-time">{dateTimeLabel(event.occurredAt)}</div></div>)}</div> : <div className="recommendation"><Empty>No activity recorded yet.</Empty></div>}
            </Panel>
          </div>
        </div>
      </>}

      <div className="footer-actions" style={{ justifyContent: "space-between", marginTop: 17 }}>
        <span className="small-mono">State syncs after each action</span>
        <div className="footer-actions"><button className="btn btn-small btn-quiet" onClick={() => void loadState(businessId)} disabled={loading || busy}><RefreshCw />Refresh state</button><button className="btn btn-small btn-quiet" onClick={() => openModal("reset")} disabled={busy}><RotateCcw />Reset demo</button></div>
      </div>
    </main>

    {modal && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head"><div>
          <h2 id="dialog-title">{modal === "add" ? "Add a stock batch" : modal === "edit" ? "Edit inventory record" : modal === "approve" ? "Approve recommendation" : modal === "reject" ? "Reject recommendation" : modal === "complete" ? "Report task outcome" : "Reset demo data"}</h2>
          <p className="dialog-intro">{modal === "add" ? `Add synthetic inventory to ${response?.business.name ?? "this demo shop"}.` : modal === "edit" ? "Update this product and batch in the selected demo shop. Related expiry risks are recalculated." : modal === "approve" ? "Approval creates a staff task. Assign it to a simulated team member." : modal === "reject" ? "Record an owner decision for this simulated recommendation." : modal === "complete" ? "Record what staff report doing. Completing a task does not adjust stock quantity." : `Restore the initial synthetic data for ${response?.business.name ?? "this demo shop"} only.`}</p>
        </div><button className="icon-btn" aria-label="Close dialog" onClick={() => setModal(null)} disabled={busy}><X /></button></div>

        {(modal === "add" || modal === "edit") && <form onSubmit={submitInventory}>
          <div className="form-grid">
            <div className="field"><label htmlFor="productName">Product name</label><input id="productName" name="productName" required defaultValue={selectedInventory?.product.name} placeholder="e.g. Fresh milk" /></div>
            <div className="field"><label htmlFor="sku">SKU</label><input id="sku" name="sku" required defaultValue={selectedInventory?.product.sku} placeholder="e.g. MILK" /></div>
            <div className="field"><label htmlFor="category">Category</label><input id="category" name="category" required defaultValue={selectedInventory?.product.category} placeholder="Dairy" /></div>
            <div className="field"><label htmlFor="unit">Unit</label><input id="unit" name="unit" required defaultValue={selectedInventory?.product.unit} placeholder="bottles" /></div>
            <div className="field"><label htmlFor="batchId">Batch ID</label><input id="batchId" name="batchId" required defaultValue={selectedInventory?.batch.id} placeholder="e.g. MILK-003" /></div>
            <div className="field"><label htmlFor="quantity">Quantity</label><input id="quantity" name="quantity" required type="number" min="1" max="100000" step="1" inputMode="numeric" defaultValue={selectedInventory?.batch.quantity} placeholder="24" /></div>
            <div className="field full"><label htmlFor="expiryDate">Expiry date</label><input id="expiryDate" name="expiryDate" required type="date" defaultValue={selectedInventory?.batch.expiryDate} /></div>
          </div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle /> : modal === "edit" ? <Check /> : <Plus />}{modal === "edit" ? "Save changes" : "Add batch"}</button></div>
        </form>}
        {modal === "approve" && <div>
          {selectedRecommendation && <div className="explain-box"><div className="explain-label">Recommendation</div><div className="explain-text"><strong>{selectedRecommendation.productName}</strong> · {selectedRecommendation.quantity} {selectedRecommendation.unit} · expires {dateLabel(selectedRecommendation.expiryDate)}<br />{selectedRecommendation.suggestedAction}</div></div>}
          <div className="field" style={{ marginTop: 15 }}><label htmlFor="assignee">Assign task to</label><select id="assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option>Aina</option><option>Ravi</option><option>Mei Ling</option><option>Unassigned</option></select></div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="dialog-actions"><button className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={approveRecommendation} disabled={busy}>{busy ? <LoaderCircle /> : <Check />}Approve &amp; create task</button></div>
        </div>}
        {modal === "reject" && <div>
          <div className="field"><label htmlFor="rejectReason">Reason (optional)</label><textarea id="rejectReason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Add context for the activity record" /></div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="dialog-actions"><button className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="btn btn-danger" onClick={rejectRecommendation} disabled={busy}>{busy ? <LoaderCircle /> : <XCircle />}Reject recommendation</button></div>
        </div>}
        {modal === "complete" && <div>
          <div className="explain-box"><div className="explain-label">Task · {selectedTask?.assignedTo}</div><div className="explain-text">{selectedTask?.instruction}</div></div>
          <div className="field" style={{ marginTop: 15 }}><label htmlFor="outcome">Staff-reported outcome</label><textarea id="outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="What was reported as done?" /></div>
          <div className="decision-note"><AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />This is a simulated staff report only. No quantity adjustment is made.</div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="dialog-actions"><button className="btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={completeTask} disabled={busy}>{busy ? <LoaderCircle /> : <Check />}Save reported outcome</button></div>
        </div>}
        {modal === "reset" && <div>
          <div className="explain-box"><div className="explain-text">This replaces the current demo state with the server’s initial synthetic setup. Current simulated changes and event history will be cleared.</div></div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <div className="dialog-actions"><button className="btn" onClick={() => setModal(null)} disabled={busy}>Keep current state</button><button className="btn btn-danger" onClick={() => void sendAction({ type: "reset" }, "Demo reset to its initial state.")} disabled={busy}>{busy ? <LoaderCircle /> : <RotateCcw />}Reset demo</button></div>
        </div>}
      </div>
    </div>}
    {toast && <div className={`toast ${toastError ? "error" : ""}`} role="status">{toastError ? <AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 7 }} /> : <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 7 }} />}{toast}</div>}
  </div>;
}

function RecommendationCard({ recommendation, role, busy, onApprove, onReject }: { recommendation: Recommendation; role: Role; busy: boolean; onApprove: () => void; onReject: () => void }) {
  return <div className="recommendation">
    <div className="rec-top"><div><div className="rec-product">{recommendation.productName}</div><div className="rec-quantity">{recommendation.sku} · {recommendation.quantity} {recommendation.unit} · expires {dateLabel(recommendation.expiryDate)}</div></div><span className="rec-status">{recommendation.status}</span></div>
    {recommendation.batchId === "MILK-001" && recommendation.expiryDate === "2026-10-25" && <div className="explain-box"><div className="explain-label">Why this batch is flagged</div><div className="explain-text">MILK-001 · 8 bottles · expires 25 Oct 2026. Demo date: 24 Oct 2026. The expiry rule flags it as approaching because it expires within the configured {recommendation.daysUntilExpiry < 0 ? "threshold" : "threshold window"} ({recommendation.daysUntilExpiry} day{recommendation.daysUntilExpiry === 1 ? "" : "s"} away).</div></div>}
    <div className="explain-box"><div className="explain-label">Rule explanation</div><div className="explain-text">{recommendation.explanation}</div></div>
    <div className="suggestion"><ArrowDownRight /><div><div className="explain-label">Suggested action</div>{recommendation.suggestedAction}</div></div>
    {recommendation.status === "pending" && role === "owner" && <div className="rec-actions"><button className="btn btn-leaf btn-small" onClick={onApprove} disabled={busy}><Check />Approve &amp; assign</button><button className="btn btn-small btn-danger" onClick={onReject} disabled={busy}><XCircle />Reject</button></div>}
    {recommendation.status === "pending" && role === "staff" && <div className="decision-note">Owner decision controls are shown in Owner demo role.</div>}
    {recommendation.status !== "pending" && <div className="decision-note">{recommendation.status === "approved" ? "Approved" : "Rejected"}{recommendation.decisionBy ? ` by ${recommendation.decisionBy}` : ""}{recommendation.decisionAt ? ` · ${dateTimeLabel(recommendation.decisionAt)}` : ""}</div>}
  </div>;
}

function TaskRow({ task, role, busy, onComplete }: { task: StaffTask; role: Role; busy: boolean; onComplete: () => void }) {
  return <div className="task">
    <div className="task-line"><div className="task-name">{task.title}</div><div className="task-owner">{task.assignedTo}</div></div>
    <div className="task-instruction">{task.instruction}</div>
    <div className="task-foot"><span className={`task-state ${task.status === "completed" ? "done" : ""}`}>{task.status}</span>{task.status === "open" && role === "staff" && <button className="btn btn-small" onClick={onComplete} disabled={busy}><Check />Report done</button>}{task.status === "open" && role === "owner" && <span className="task-owner">Switch to Staff to report</span>}</div>
    {task.status === "completed" && task.outcome && <div className="reported"><b>Staff-reported outcome · no quantity adjustment</b>{task.outcome}</div>}
  </div>;
}

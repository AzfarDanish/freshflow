"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, Bot, CalendarDays, Check, CheckCircle2, ClipboardList,
  Info, LoaderCircle, Package, Pencil, Plus, RefreshCw, RotateCcw, Search,
  Settings2, ShieldAlert, SlidersHorizontal, Sparkles, X, XCircle, Activity, Gauge,
  Trash2,
} from "lucide-react";
import { DEFAULT_BUSINESS_ID } from "@/src/lib/businesses";
import { OPERATIONS, operationForPath } from "@/src/lib/operation-navigation";
import type { OperationId } from "@/src/lib/operation-navigation";
import { canAccessOperation } from "@/src/lib/access-control";
import { OperationPageContext } from "./OperationPage";
import AssistantSidebar from "./AssistantSidebar";
import type { InsightsAssistantRequest } from "./AssistantSidebar";
import { TASK_OUTCOME_LABELS, TASK_PROGRESS_LABELS } from "@/src/lib/types";
import type { AppState, InventoryAction, InventoryBatch, Product, Recommendation, StaffTask, StateResponse, TaskOutcomeType, TaskProgressType } from "@/src/lib/types";
import {
  batchRisk, dateLabel, expiryGroups, filterInventory, inventoryRows, sortRecommendations,
  sortTasks, taskInventorySummary, workspaceHasOnlySyntheticRecords,
} from "@/src/lib/operations-view";
import type { InventoryFilter } from "@/src/lib/operations-view";
import { Sidebar } from "@/app/operations/Sidebar";
import { EmptyState, LoadingRows, Section, StatusBadge } from "@/app/operations/ui";
import { ActivityList, ExpiryWatchTable, RecommendationCard, TaskRow } from "@/app/operations/workflow";
import type { Role } from "@/app/operations/workflow";
import { InsightsPanel, LegacyCleanupReview } from "@/app/production/ProductionPanels";
import { InvoiceReceivingPanel } from "@/app/production/InvoiceReceivingPanel";

function decimalToMinor(raw: string): number | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter a valid amount with no more than two decimal places.");
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Amount is too large.");
  return negative ? -minor : minor;
}

type ModalKind = "add" | "edit" | "delete" | "approve" | "reject" | "progress" | "complete" | "reset" | "waste" | "correction" | null;
type InventorySelection = { product: Product; batch: InventoryBatch };

const emptyState: AppState = {
  products: [], recommendations: [], tasks: [], activity: [], invoiceIntakes: [],
  settings: { thresholdDays: 3, demoDate: "" },
};

const DIALOG_TITLES: Record<Exclude<ModalKind, null>, string> = {
  add: "Add stock batch",
  edit: "Edit inventory record",
  delete: "Delete inventory batch",
  approve: "Approve recommendation",
  reject: "Reject recommendation",
  progress: "Update task progress",
  complete: "Report task outcome",
  reset: "Reset whole demo",
  waste: "Record stock waste",
  correction: "Record stock discrepancy correction",
};

export default function OperationsWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const [response, setResponse] = useState<StateResponse | null>(null);
  const responseRef = useRef<StateResponse | null>(null);
  const busyRef = useRef(false);
  const modalOpenRef = useRef(false);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const loadRequestId = useRef(0);
  const businessId = response?.businessId ?? DEFAULT_BUSINESS_ID;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(3);
  const [formError, setFormError] = useState("");
  const [assignee, setAssignee] = useState("");
  const [customActionDirective, setCustomActionDirective] = useState("");
  const [useCustomDirective, setUseCustomDirective] = useState(false);
  const [decisionQuery, setDecisionQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | "open" | "completed">("all");
  const [rejectReason, setRejectReason] = useState("");
  const [outcomeType, setOutcomeType] = useState<TaskOutcomeType>("rotated");
  const [outcomeExplanation, setOutcomeExplanation] = useState("");
  const [progressType, setProgressType] = useState<TaskProgressType>("not_started");
  const [progressNote, setProgressNote] = useState("");
  const [selectedInventory, setSelectedInventory] = useState<InventorySelection | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [resetAcknowledged, setResetAcknowledged] = useState(false);

  // Modal state for Waste and Correction
  const [modalProductId, setModalProductId] = useState("");
  const [modalBatchId, setModalBatchId] = useState("");
  const [modalWasteQuantity, setModalWasteQuantity] = useState("");
  const [modalWasteCost, setModalWasteCost] = useState("");
  const [modalWasteReasonPreset, setModalWasteReasonPreset] = useState("Expired / past shelf life");
  const [modalWasteReasonCustom, setModalWasteReasonCustom] = useState("");
  const [modalWasteOccurredAt, setModalWasteOccurredAt] = useState("");

  const [modalCorrCount, setModalCorrCount] = useState("");
  const [modalCorrCost, setModalCorrCost] = useState("");
  const [modalCorrReasonPreset, setModalCorrReasonPreset] = useState("Physical stock-take discrepancy");
  const [modalCorrReasonCustom, setModalCorrReasonCustom] = useState("");
  const [modalCorrOccurredAt, setModalCorrOccurredAt] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const assistantToggleRef = useRef<HTMLButtonElement>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [insightsAssistantRequest, setInsightsAssistantRequest] = useState<InsightsAssistantRequest | null>(null);

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    requestAnimationFrame(() => assistantToggleRef.current?.focus());
  }, []);

  const state = response?.state ?? emptyState;
  const businessName = "this workspace";
  const referenceDate = state.settings.demoDate;
  const thresholdDays = state.settings.thresholdDays;

  const applyStoredState = useCallback((body: StateResponse, preserveDraft = true) => {
    const previousThreshold = responseRef.current?.state.settings.thresholdDays;
    setThresholdDraft((draft) =>
      preserveDraft && previousThreshold !== undefined && draft !== previousThreshold
        ? draft
        : body.state.settings.thresholdDays,
    );
    responseRef.current = body;
    setResponse(body);
    setRole(body.role ?? "staff");
  }, []);

  const loadState = useCallback(async (targetBusinessId: string, background = false) => {
    if (busyRef.current || (background && modalOpenRef.current)) return;
    const requestId = ++loadRequestId.current;
    if (!background) setLoading(true);
    try {
      const res = await fetch("/api/state", { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not load the latest shop state.");
      if (requestId !== loadRequestId.current) return;
      applyStoredState(body as StateResponse);
      setLoadError("");
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      setLoadError(error instanceof Error ? error.message : "Could not load the latest shop state.");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [applyStoredState]);

  const changePreviewRole = useCallback(async (nextRole: Role) => {
    if (busyRef.current || nextRole === responseRef.current?.role) return;
    setRole(nextRole);
    busyRef.current = true;
    ++loadRequestId.current;
    setBusy(true);
    setActionError("");
    try {
      const roleResponse = await fetch("/api/role", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const roleBody = await roleResponse.json();
      if (!roleResponse.ok) throw new Error(roleBody?.error || "Could not change the preview role.");
      const stateResponse = await fetch("/api/state", { cache: "no-store" });
      const stateBody = await stateResponse.json();
      if (!stateResponse.ok) throw new Error(stateBody?.error || "Could not load role permissions.");
      applyStoredState(stateBody as StateResponse);
      setLoadError("");
      const activeOperation = operationForPath(pathname);
      if (activeOperation && !canAccessOperation(nextRole, activeOperation.id)) router.replace("/");
      syncChannelRef.current?.postMessage("changed");
    } catch (error) {
      if (responseRef.current?.role) setRole(responseRef.current.role);
      const message = error instanceof Error ? error.message : "Could not change the preview role.";
      setActionError(message);
      setToastError(true);
      setToast(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [applyStoredState, pathname, router]);

  useEffect(() => {
    const activeOperation = operationForPath(pathname);
    if (response && activeOperation && !canAccessOperation(response.role ?? role, activeOperation.id)) {
      router.replace("/");
    }
  }, [pathname, response, role, router]);

  useEffect(() => { void loadState(businessId, true); }, [businessId, pathname, loadState]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadState(businessId, true);
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("freshflow-stored-state") : null;
    syncChannelRef.current = channel;
    if (channel) channel.onmessage = refresh;
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      channel?.close();
      syncChannelRef.current = null;
    };
  }, [businessId, loadState]);
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
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    contentRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [pathname]);

  modalOpenRef.current = modal !== null;

  useEffect(() => {
    if (!modal) return;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button[data-autofocus]");
    (first ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
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
    if (busyRef.current) return false;
    busyRef.current = true;
    ++loadRequestId.current;
    setLoading(false);
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
      applyStoredState(body as StateResponse, action.type !== "set_threshold" && action.type !== "reset");
      setLoadError("");
      if (action.type === "reset") {
        setInventoryQuery("");
        setInventoryFilter("all");
        setSelectedRecommendation(null);
        setSelectedTask(null);
        setSelectedInventory(null);
      }
      syncChannelRef.current?.postMessage("changed");
      closeModal();
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
      busyRef.current = false;
      setBusy(false);
    }
  }, [businessId, closeModal, applyStoredState]);

  const groups = useMemo(() => expiryGroups(state.products, referenceDate, thresholdDays), [state.products, referenceDate, thresholdDays]);
  const allRows = useMemo(() => inventoryRows(state.products), [state.products]);
  const filteredInventory = useMemo(
    () => filterInventory(allRows, inventoryQuery, inventoryFilter, referenceDate, thresholdDays),
    [allRows, inventoryQuery, inventoryFilter, referenceDate, thresholdDays],
  );
  const allRecommendations = useMemo(() => sortRecommendations(state.recommendations), [state.recommendations]);
  const recommendations = useMemo(() => {
    if (!decisionQuery.trim()) return allRecommendations;
    const q = decisionQuery.toLowerCase().trim();
    return allRecommendations.filter((r) =>
      r.productName.toLowerCase().includes(q) ||
      r.sku.toLowerCase().includes(q) ||
      r.batchId.toLowerCase().includes(q) ||
      r.explanation.toLowerCase().includes(q) ||
      r.suggestedAction.toLowerCase().includes(q)
    );
  }, [allRecommendations, decisionQuery]);

  const allTasks = useMemo(() => sortTasks(state.tasks), [state.tasks]);
  const tasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (taskFilter === "open" && t.status !== "open") return false;
      if (taskFilter === "completed" && t.status !== "completed") return false;
      if (!taskQuery.trim()) return true;
      const q = taskQuery.toLowerCase().trim();
      return (
        t.title.toLowerCase().includes(q) ||
        (t.assignedTo && t.assignedTo.toLowerCase().includes(q)) ||
        (t.productName && t.productName.toLowerCase().includes(q)) ||
        (t.sku && t.sku.toLowerCase().includes(q)) ||
        (t.instruction && t.instruction.toLowerCase().includes(q))
      );
    });
  }, [allTasks, taskFilter, taskQuery]);

  const activity = useMemo(() => [...state.activity].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [state.activity]);
  const pendingCount = response?.pendingRecommendationCount ?? state.recommendations.filter((recommendation) => recommendation.status === "pending").length;
  const recommendationCount = response?.recommendationCount ?? state.recommendations.length;
  const openTaskCount = state.tasks.filter((task) => task.status === "open").length;
  const invoiceReviewCount = state.invoiceIntakes.filter((intake) => intake.status === "review").length;
  const resetAllowed = Boolean(response?.business.simulated) && workspaceHasOnlySyntheticRecords(state);
  const selectedTaskInventory = selectedTask
    ? taskInventorySummary(selectedTask, state.recommendations.find((item) => item.id === selectedTask.recommendationId))
    : "";
  const storageLabel = response
    ? response.persistenceMode === "postgres" ? "Saved to PostgreSQL" : "Test-only local storage"
    : "Connecting to storage…";

  function openModal(kind: ModalKind, recommendation?: Recommendation, task?: StaffTask, inventory?: InventorySelection) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError("");
    setFormError("");
    if (kind === "approve") {
      setCustomActionDirective(recommendation?.suggestedAction ?? "");
      setUseCustomDirective(false);
    }
    if (kind === "reject") setRejectReason("");
    if (kind === "reset") setResetAcknowledged(false);
    if (kind === "complete") {
      setOutcomeType("rotated");
      setOutcomeExplanation("");
    }
    if (kind === "progress" && task) {
      setProgressType(task.progressType ?? "not_started");
      setProgressNote(task.progressNote ?? "");
    }
    if (kind === "waste") {
      const pId = inventory?.product.id ?? (state.products[0]?.id ?? "");
      const prod = state.products.find((p) => p.id === pId);
      const bId = inventory?.batch.id ?? (prod?.batches[0]?.id ?? "");
      setModalProductId(pId);
      setModalBatchId(bId);
      setModalWasteQuantity("");
      setModalWasteCost("");
      setModalWasteReasonPreset("Expired / past shelf life");
      setModalWasteReasonCustom("");
      setModalWasteOccurredAt(new Date().toISOString().slice(0, 16));
    }
    if (kind === "correction") {
      const pId = inventory?.product.id ?? (state.products[0]?.id ?? "");
      const prod = state.products.find((p) => p.id === pId);
      const bId = inventory?.batch.id ?? (prod?.batches[0]?.id ?? "");
      setModalProductId(pId);
      setModalBatchId(bId);
      setModalCorrCount("");
      setModalCorrCost("");
      setModalCorrReasonPreset("Physical stock-take discrepancy");
      setModalCorrReasonCustom("");
      setModalCorrOccurredAt(new Date().toISOString().slice(0, 16));
    }
    setSelectedRecommendation(recommendation ?? null);
    setSelectedTask(task ?? null);
    setSelectedInventory(inventory ?? null);
    setModal(kind);
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
    const directive = useCustomDirective ? customActionDirective.trim() : undefined;
    if (useCustomDirective && !directive) {
      setFormError("Please enter your custom action directive, or uncheck custom directive.");
      return;
    }
    void sendAction({
      type: "approve",
      payload: {
        recommendationId: selectedRecommendation.id,
        assignedTo: assignee.trim() || "Unassigned",
        customInstruction: directive,
        role,
      },
    }, "Recommendation approved; a staff task was created.");
  }
  function deleteInventoryRecord() {
    if (!selectedInventory) return;
    void sendAction({
      type: "delete_inventory",
      payload: {
        productId: selectedInventory.product.id,
        batchId: selectedInventory.batch.id,
        confirmed: true,
      },
    }, "Inventory batch deleted.");
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
  function updateTaskProgress() {
    if (!selectedTask) return;
    if (progressType === "blocked" && progressNote.trim().length < 3) {
      setFormError("Explain why the task is blocked in at least 3 characters.");
      return;
    }
    void sendAction({
      type: "update_task_progress",
      payload: { taskId: selectedTask.id, progressType, progressNote: progressNote.trim() || undefined, role },
    }, "Task progress updated.");
  }
  function changeThreshold() {
    void sendAction({ type: "set_threshold", payload: { thresholdDays: thresholdDraft } }, "Expiry threshold updated.");
  }

  async function submitWasteModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const selectedProduct = state.products.find((p) => p.id === modalProductId);
    const selectedBatch = selectedProduct?.batches.find((b) => b.id === modalBatchId);
    const amount = Number(modalWasteQuantity);
    if (!selectedProduct || !selectedBatch) {
      setFormError("Choose a valid product and recorded batch.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter a positive waste quantity.");
      return;
    }
    if (amount > selectedBatch.quantity) {
      setFormError(`Waste quantity cannot exceed current batch stock (${selectedBatch.quantity} ${selectedProduct.unit}).`);
      return;
    }
    let costMinor: number | undefined;
    try {
      costMinor = decimalToMinor(modalWasteCost);
      if (costMinor !== undefined && costMinor < 0) {
        setFormError("Unit cost cannot be negative.");
        return;
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Invalid unit cost.");
      return;
    }
    const finalReason = modalWasteReasonPreset === "Other"
      ? modalWasteReasonCustom.trim()
      : (modalWasteReasonCustom.trim() ? `${modalWasteReasonPreset}: ${modalWasteReasonCustom.trim()}` : modalWasteReasonPreset);
    if (!finalReason) {
      setFormError("Specify a reason for recording this waste.");
      return;
    }
    const parsedTime = new Date(modalWasteOccurredAt);
    if (Number.isNaN(parsedTime.getTime())) {
      setFormError("Choose a valid occurrence time.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "record_movement",
          payload: {
            requestId: crypto.randomUUID(),
            kind: "waste",
            productId: modalProductId,
            batchId: modalBatchId,
            quantity: amount,
            ...(costMinor === undefined ? {} : { unitCostMinor: costMinor }),
            reason: finalReason,
            occurredAt: parsedTime.toISOString(),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || body?.message || "Failed to record waste.");

      await loadState(businessId);
      syncChannelRef.current?.postMessage("changed");
      closeModal();
      setToast(`Waste recorded: ${amount} ${selectedProduct.unit} written down from ${selectedProduct.name}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record waste.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrectionModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const selectedProduct = state.products.find((p) => p.id === modalProductId);
    const selectedBatch = selectedProduct?.batches.find((b) => b.id === modalBatchId);
    const count = Number(modalCorrCount);
    if (!selectedProduct || !selectedBatch) {
      setFormError("Choose a valid product and recorded batch.");
      return;
    }
    if (!Number.isFinite(count) || count < 0) {
      setFormError("Enter a valid non-negative actual physical count.");
      return;
    }
    const prev = selectedBatch.quantity;
    if (Math.abs(count - prev) < 0.0001) {
      setFormError("Actual count matches the recorded stock. No discrepancy to correct.");
      return;
    }
    let costMinor: number | undefined;
    try {
      costMinor = decimalToMinor(modalCorrCost);
      if (costMinor !== undefined && costMinor < 0) {
        setFormError("Unit cost cannot be negative.");
        return;
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Invalid unit cost.");
      return;
    }
    const finalReason = modalCorrReasonPreset === "Other"
      ? modalCorrReasonCustom.trim()
      : (modalCorrReasonCustom.trim() ? `${modalCorrReasonPreset}: ${modalCorrReasonCustom.trim()}` : modalCorrReasonPreset);
    if (!finalReason) {
      setFormError("A reason explanation is mandatory for inventory discrepancy corrections.");
      return;
    }
    const parsedTime = new Date(modalCorrOccurredAt);
    if (Number.isNaN(parsedTime.getTime())) {
      setFormError("Choose a valid occurrence time.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "record_movement",
          payload: {
            requestId: crypto.randomUUID(),
            kind: "adjustment",
            productId: modalProductId,
            batchId: modalBatchId,
            correctedQuantity: count,
            ...(costMinor === undefined ? {} : { unitCostMinor: costMinor }),
            reason: finalReason,
            occurredAt: parsedTime.toISOString(),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || body?.message || "Failed to record stock correction.");

      const diff = Math.round((count - prev) * 10000) / 10000;
      await loadState(businessId);
      syncChannelRef.current?.postMessage("changed");
      closeModal();
      setToast(`Stock corrected: ${selectedProduct.name} batch ${modalBatchId} adjusted from ${prev} to ${count} ${selectedProduct.unit} (${diff > 0 ? "+" : ""}${diff} ${selectedProduct.unit}).`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record stock correction.");
    } finally {
      setBusy(false);
    }
  }

  const controlsLocked = busy || modal !== null;

  function renderPage(page: OperationId) {
    const operation = OPERATIONS.find((item) => item.id === page)!;
    if (!canAccessOperation(role, page)) {
      return <div className="alert alert-danger" role="alert">This page is not available in the Staff preview. Return to Overview or switch preview roles.</div>;
    }
    return <>
      <div className="page-header">
        <div>
          <h1 tabIndex={-1}>{operation.label}</h1>
          <p className="page-meta">
            <span><CalendarDays aria-hidden="true" />Reference date <strong>{dateLabel(referenceDate)}</strong></span>
            <span>Expiry threshold <strong>{thresholdDays} days</strong></span>
            <span title="Anyone with this link can access the persistent demo data and choose either Owner or Staff."><Info aria-hidden="true" />Public hackathon preview · not secure</span>
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void loadState(businessId)} disabled={loading || busy}><RefreshCw aria-hidden="true" className={loading ? "spin" : ""} />Refresh</button>
          {role === "owner" && (page === "overview" || page === "inventory") && <button type="button" className="btn btn-primary" onClick={() => openModal("add")} disabled={busy || loading || Boolean(loadError)}><Plus aria-hidden="true" />Add stock</button>}
        </div>
      </div>

      {actionError && <div className="alert alert-danger" role="alert"><AlertTriangle aria-hidden="true" /><span>{actionError}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setActionError("")}>Dismiss</button></div>}

      {loadError ? <div className="alert alert-danger" role="alert"><AlertTriangle aria-hidden="true" /><span>{loadError}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadState(businessId)}><RefreshCw aria-hidden="true" />Retry</button></div> : <>
        {page === "overview" && <>
        <dl className="stats" aria-label="Reference date summary">
          <div className="stat"><dt>Expired batches</dt><dd className={groups.expired.length ? "tone-danger" : ""}>{loading ? "—" : groups.expired.length}</dd><span className="stat-note">Shown separately from approaching</span></div>
          <div className="stat"><dt>Approaching expiry</dt><dd className={groups.approaching.length ? "tone-warning" : ""}>{loading ? "—" : groups.approaching.length}</dd><span className="stat-note">Within {thresholdDays} days</span></div>
          <div className="stat"><dt>Awaiting decision</dt><dd>{loading ? "—" : pendingCount}</dd><span className="stat-note">{recommendationCount} recommendations total</span></div>
          <div className="stat"><dt>Open staff tasks</dt><dd>{loading ? "—" : openTaskCount}</dd><span className="stat-note">{state.tasks.length} tasks total</span></div>
        </dl>

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
        </>}

        {page === "insights" && <InsightsPanel
          products={state.products}
          timeZone={state.settings.timeZone}
          onChanged={() => void loadState(businessId)}
          onExplain={({ from, to }) => {
            setInsightsAssistantRequest({ id: crypto.randomUUID(), from, to });
            setAssistantOpen(true);
          }}
        />}
        {page === "decisions" &&
          <Section
            id="decisions"
            icon={Sparkles}
            title="Decisions"
            description={role === "owner" ? "Review each rule-based recommendation, then approve or reject" : "Manager decisions on rule-based recommendations"}
            meta={loading ? undefined : `${recommendations.length} of ${allRecommendations.length}`}
            actions={
              <div className="toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <span className="sr-only">Search decisions</span>
                  <input
                    type="search"
                    value={decisionQuery}
                    onChange={(e) => setDecisionQuery(e.target.value)}
                    placeholder="Search product, SKU or action"
                  />
                </label>
              </div>
            }
            className="scroll-panel"
          >
            {loading ? <LoadingRows label="Loading recommendations" /> :
              recommendations.length ? <div className="list">{recommendations.map((recommendation) => <RecommendationCard key={recommendation.id} recommendation={recommendation} role={role} busy={busy} onApprove={() => openModal("approve", recommendation)} onReject={() => openModal("reject", recommendation)} />)}</div> :
              <EmptyState title={decisionQuery ? "No matching decisions" : "No recommendations"}>
                {decisionQuery ? "Try clearing your search query." : "A batch inside the expiry threshold creates one."}
              </EmptyState>}
          </Section>
        }

        {page === "tasks" &&
          <Section
            id="tasks"
            icon={ClipboardList}
            title="Staff tasks"
            description="Created when a manager approves a recommendation; staff report the outcome"
            meta={loading ? undefined : `${tasks.length} of ${allTasks.length}`}
            actions={
              <div className="toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" />
                  <span className="sr-only">Search tasks</span>
                  <input
                    type="search"
                    value={taskQuery}
                    onChange={(e) => setTaskQuery(e.target.value)}
                    placeholder="Search task, assignee or SKU"
                  />
                </label>
                <label className="select-field">
                  <span className="sr-only">Filter tasks by status</span>
                  <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value as "all" | "open" | "completed")}>
                    <option value="all">All status</option>
                    <option value="open">Open</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
              </div>
            }
            className="scroll-panel"
          >
            {loading ? <LoadingRows label="Loading staff tasks" /> :
              tasks.length ? <div className="list">{tasks.map((task) => <TaskRow key={task.id} task={task} recommendation={state.recommendations.find((item) => item.id === task.recommendationId)} busy={busy} onProgress={() => openModal("progress", undefined, task)} onComplete={() => openModal("complete", undefined, task)} />)}</div> :
              <EmptyState title={taskQuery || taskFilter !== "all" ? "No matching tasks" : "No staff tasks"}>
                {taskQuery || taskFilter !== "all" ? "Try adjusting your search or status filter." : "Approve a pending recommendation to create one."}
              </EmptyState>}
          </Section>
        }

        {page === "activity" &&
          <Section id="activity" icon={Activity} title="Activity" description="Newest first · decisions, tasks, inventory and invoice events" meta={loading ? undefined : activity.length} className="scroll-panel">
            {loading ? <LoadingRows label="Loading activity" /> : <ActivityList events={activity} />}
          </Section>
        }

        {page === "invoices" &&
        <div id="invoices" className="anchor-section">
          <InvoiceReceivingPanel state={state} onChanged={() => void loadState(businessId)} />
        </div>
        }

        {page === "inventory" &&
        <Section
          id="inventory"
          icon={Package}
          title="Inventory"
          description="All product batches"
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
            {role === "owner" && (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => openModal("add")} disabled={busy || loading}><Plus aria-hidden="true" />Add stock</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openModal("waste")} disabled={busy || loading}><Trash2 aria-hidden="true" />Record waste</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openModal("correction")} disabled={busy || loading}><SlidersHorizontal aria-hidden="true" />Correct stock</button>
              </>
            )}
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
                      <td className="row-actions">{role === "owner" && <div className="toolbar">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openModal("waste", undefined, undefined, { product, batch })} disabled={busy} aria-label={`Record waste for ${product.name} batch ${batch.id}`}>Waste</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openModal("correction", undefined, undefined, { product, batch })} disabled={busy} aria-label={`Correct stock for ${product.name} batch ${batch.id}`}>Correct</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openModal("edit", undefined, undefined, { product, batch })} disabled={busy} aria-label={`Edit ${product.name} batch ${batch.id}`}><Pencil aria-hidden="true" />Edit</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openModal("delete", undefined, undefined, { product, batch })} disabled={busy} aria-label={`Delete ${product.name} batch ${batch.id}`}><Trash2 aria-hidden="true" />Delete</button>
                      </div>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div> : allRows.length ? <EmptyState title="No matching batches">Adjust the search or status filter.</EmptyState> : <EmptyState title="No inventory yet">Add a stock batch or confirm an invoice line to get started.</EmptyState>}
        </Section>
        }

        {page === "settings" &&
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
                <li><strong>Operational data.</strong> Inventory, receipts, movements, and audit history use persisted records. Unknown history and costs are not invented.</li>
                <li><strong>Public testing profiles.</strong> Anyone with this link can select Manager or Staff and access this persistent database. Do not store private or sensitive production information here.</li>
                <li><strong>Reference date.</strong> Expiry uses today&apos;s calendar date in {state.settings.timeZone ?? "Asia/Kuala_Lumpur"}.</li>
                <li><strong>Operations.</strong> Live stock-movement tracking with zero invented forecasting. Completing a task records employee outcome report.</li>
              </ul>
            </div>
          </div>

          <LegacyCleanupReview onChanged={() => void loadState(businessId)} />
          <div className="alert"><Info aria-hidden="true" />Dataset restoration is disabled for operational records. Legacy cleanup requires a reviewed backup and explicit migration confirmation.</div>
        </Section>
        }
      </>}
    </>;
  }

  return <div className="shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Sidebar counts={{ decisions: pendingCount, tasks: openTaskCount, invoices: invoiceReviewCount }} locked={controlsLocked} role={role} />
    <main className="main" id="main-content" tabIndex={-1}>
      <header className="topbar">
        <div className="topbar-context">
          <span className="topbar-label">Workspace</span>
          <span className="topbar-value">Operations</span>
        </div>
        <div className="top-actions">
          <div className="control" role="group" aria-labelledby="role-view-label">
            <span className="control-label" id="role-view-label" title="Testing profiles: select Manager or Staff view.">PROFILE VIEW</span>
            <div className="segmented">
              {(["owner", "staff"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={role === value} className={role === value ? "selected" : ""} onClick={() => void changePreviewRole(value)} disabled={controlsLocked}>
                  {value === "owner" ? "Manager" : "Staff"}
                </button>
              ))}
            </div>
          </div>
          <button
            ref={assistantToggleRef}
            type="button"
            className="assistant-toggle"
            aria-label={assistantOpen ? "Close AI assistant" : "Open AI assistant"}
            aria-expanded={assistantOpen}
            aria-controls="freshflow-assistant-sidebar"
            onClick={() => assistantOpen ? closeAssistant() : setAssistantOpen(true)}
          >
            <Bot aria-hidden="true" size={16} />
            <span>AI assistant</span>
          </button>
        </div>
      </header>
      <div className="operation-page" ref={contentRef}>
        <OperationPageContext.Provider value={renderPage}>
          {children}
        </OperationPageContext.Provider>
      </div>
    </main>

    <AssistantSidebar
      open={assistantOpen}
      role={role}
      insightRequest={insightsAssistantRequest}
      onClose={closeAssistant}
    />

    {modal && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) closeModal(); }}>
      <div className={`dialog ${modal === "reset" || modal === "delete" ? "dialog-danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-intro" ref={dialogRef} tabIndex={-1}>
        <div className="dialog-head">
          <div>
            <h2 id="dialog-title">{DIALOG_TITLES[modal]}</h2>
            <p className="dialog-intro" id="dialog-intro">{modal === "add" ? `Add a product batch to ${businessName}.` : modal === "edit" ? "Update this product and batch. Related expiry risks are recalculated." : modal === "delete" ? "Remove this batch from inventory. Historical decisions and completed reports remain." : modal === "approve" ? "Approval creates one staff task linked to this recommendation." : modal === "reject" ? "Record the owner decision. No task is created." : modal === "progress" ? "Update this task's progress without changing stock quantities." : modal === "complete" ? "Record the reported task outcome. Completing a task does not adjust stock quantity." : modal === "waste" ? "Record expired, spoiled, damaged or discarded stock. Reduces batch inventory persistently." : modal === "correction" ? "Record verified physical inventory discrepancies. Preserves previous quantity and mandatory reason in history." : `This affects ${businessName} only.`}</p>
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

        {modal === "delete" && <div>
          <div className="alert alert-danger compact"><AlertTriangle aria-hidden="true" /><span>
            Delete <strong>{selectedInventory?.product.name} · {selectedInventory?.batch.id}</strong> ({selectedInventory?.batch.quantity} {selectedInventory?.product.unit}, expires {dateLabel(selectedInventory?.batch.expiryDate ?? "")}) from inventory? Pending expiry recommendations for this batch will be removed. Historical decisions and completed task reports will remain. Deletion is blocked while an open staff task references this batch.
          </span></div>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy} data-autofocus>Keep batch</button><button type="button" className="btn btn-danger" onClick={deleteInventoryRecord} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Trash2 aria-hidden="true" />}Delete batch</button></div>
        </div>}

        {modal === "approve" && <div>
          {selectedRecommendation && <div className="summary-box"><div className="summary-title">{selectedRecommendation.productName}</div><div className="summary-meta mono">{selectedRecommendation.quantity} {selectedRecommendation.unit} · Batch {selectedRecommendation.batchId} · Expires {dateLabel(selectedRecommendation.expiryDate)}</div><p><strong>Suggested rule action:</strong> {selectedRecommendation.suggestedAction}</p></div>}
          
          <div className="field" style={{ marginTop: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={useCustomDirective}
                onChange={(e) => setUseCustomDirective(e.target.checked)}
              />
              Specify a custom manager directive for staff
            </label>
            {useCustomDirective && (
              <textarea
                style={{ marginTop: "8px", minHeight: "70px" }}
                value={customActionDirective}
                onChange={(e) => setCustomActionDirective(e.target.value)}
                placeholder="e.g. Move to front discount rack at 30% off, inspect seal integrity"
                maxLength={500}
              />
            )}
            <span className="field-hint">
              {useCustomDirective
                ? "This custom directive will be assigned to staff as the task instruction."
                : "Staff task will use the rule's suggested action by default."}
            </span>
          </div>

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

        {modal === "progress" && <div>
          <div className="summary-box"><div className="summary-title">{selectedTask?.title}</div>{selectedTaskInventory && <div className="summary-meta mono">{selectedTaskInventory}</div>}</div>
          <div className="field"><label htmlFor="taskProgressType">Progress</label><select id="taskProgressType" value={progressType} onChange={(event) => setProgressType(event.target.value as TaskProgressType)}>{Object.entries(TASK_PROGRESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="field"><label htmlFor="taskProgressNote">Progress note {progressType !== "blocked" && <span className="optional">(optional)</span>}</label><textarea id="taskProgressNote" value={progressNote} onChange={(event) => setProgressNote(event.target.value)} maxLength={500} placeholder={progressType === "blocked" ? "Explain what is blocking this task" : "Describe the current progress"} /></div>
          <p className="field-hint"><Info aria-hidden="true" />This updates the task only. Stock quantities are unchanged.</p>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" onClick={updateTaskProgress} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}Save progress</button></div>
        </div>}

        {modal === "complete" && <div>
          <div className="summary-box"><div className="summary-title">{selectedTask?.title}</div>{selectedTaskInventory && <div className="summary-meta mono">{selectedTaskInventory}</div>}<p>{selectedTask?.instruction}</p><div className="summary-meta">Assigned to {selectedTask?.assignedTo}</div></div>
          <div className="field"><label htmlFor="outcomeType">{role === "staff" ? "Staff-reported outcome" : "Task outcome"}</label><select id="outcomeType" value={outcomeType} onChange={(event) => { setOutcomeType(event.target.value as TaskOutcomeType); setOutcomeExplanation(""); }}>{Object.entries(TASK_OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {outcomeType === "other" && <div className="field"><label htmlFor="outcomeExplanation">Explain the Other outcome</label><textarea id="outcomeExplanation" value={outcomeExplanation} onChange={(event) => setOutcomeExplanation(event.target.value)} minLength={3} maxLength={500} required placeholder="Describe what staff reported" /></div>}
          <p className="field-hint"><Info aria-hidden="true" />This records a report only. No stock quantity is adjusted.</p>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button><button type="button" className="btn btn-primary" onClick={completeTask} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}Save outcome</button></div>
        </div>}

        {modal === "reset" && <div>
          <div className="alert alert-danger compact"><AlertTriangle aria-hidden="true" /><span>The entire demo dataset will be replaced: all inventory, settings, recommendations, decisions, tasks and previous activity. This cannot be undone. The server refuses this operation if any non-demo records or uploaded invoices are present. No unrelated workspace is affected.</span></div>
          <label className="checkbox"><input type="checkbox" checked={resetAcknowledged} onChange={(event) => setResetAcknowledged(event.target.checked)} />I understand that the whole demo will be restored to its initial state.</label>
          {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
          <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy} data-autofocus>Keep current data</button><button type="button" className="btn btn-danger" onClick={() => void sendAction({ type: "reset", payload: { confirmed: true } }, "The whole demo was restored to its initial dataset.")} disabled={busy || !resetAcknowledged}>{busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <RotateCcw aria-hidden="true" />}Reset whole demo</button></div>
        </div>}

        {modal === "waste" && (() => {
          const prod = state.products.find((p) => p.id === modalProductId);
          const batches = prod?.batches ?? [];
          const bat = batches.find((b) => b.id === modalBatchId);

          return (
            <form onSubmit={submitWasteModal} noValidate>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="modalWasteProduct">Product</label>
                  <select
                    id="modalWasteProduct"
                    value={modalProductId}
                    onChange={(e) => {
                      const nextPid = e.target.value;
                      setModalProductId(nextPid);
                      const nextProd = state.products.find((p) => p.id === nextPid);
                      setModalBatchId(nextProd?.batches[0]?.id ?? "");
                    }}
                    required
                    disabled={busy || Boolean(selectedInventory)}
                  >
                    <option value="">Select product</option>
                    {state.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="modalWasteBatch">Batch</label>
                  <select
                    id="modalWasteBatch"
                    value={modalBatchId}
                    onChange={(e) => setModalBatchId(e.target.value)}
                    required
                    disabled={busy || !prod || Boolean(selectedInventory)}
                  >
                    <option value="">Select batch</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} · {b.quantity} {prod?.unit} (exp: {b.expiryDate || "no date"})
                      </option>
                    ))}
                  </select>
                </div>

                {bat && (
                  <div className="field full">
                    <div className="summary-box" style={{ margin: 0 }}>
                      <div className="summary-title">{prod?.name} · Batch {bat.id}</div>
                      <div className="summary-meta mono">
                        Current stock: <strong>{bat.quantity} {prod?.unit}</strong> · Expires {dateLabel(bat.expiryDate)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="modalWasteQty">
                    Quantity to discard {bat ? `(max ${bat.quantity} ${prod?.unit})` : ""}
                  </label>
                  <input
                    id="modalWasteQty"
                    type="number"
                    step="any"
                    min="0.0001"
                    max={bat?.quantity}
                    value={modalWasteQuantity}
                    onChange={(e) => setModalWasteQuantity(e.target.value)}
                    placeholder="e.g. 5"
                    required
                    disabled={busy}
                  />
                </div>

                <div className="field">
                  <label htmlFor="modalWasteCost">
                    Verified unit cost <span className="optional">(optional)</span>
                  </label>
                  <input
                    id="modalWasteCost"
                    inputMode="decimal"
                    placeholder="e.g. 2.50"
                    value={modalWasteCost}
                    onChange={(e) => setModalWasteCost(e.target.value)}
                    disabled={busy}
                  />
                  <span className="field-hint">In MYR. Leave blank if unverified.</span>
                </div>

                <div className="field">
                  <label htmlFor="modalWastePreset">Waste category</label>
                  <select
                    id="modalWastePreset"
                    value={modalWasteReasonPreset}
                    onChange={(e) => setModalWasteReasonPreset(e.target.value)}
                    disabled={busy}
                  >
                    <option value="Expired / past shelf life">Expired / past shelf life</option>
                    <option value="Damaged in transit / display">Damaged in transit / display</option>
                    <option value="Spoilage / quality defect">Spoilage / quality defect</option>
                    <option value="Customer return / unsellable">Customer return / unsellable</option>
                    <option value="Pest contamination">Pest contamination</option>
                    <option value="Other">Other reason (specify below)</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="modalWasteCustom">
                    Reason details {modalWasteReasonPreset === "Other" ? "(mandatory)" : <span className="optional">(optional)</span>}
                  </label>
                  <input
                    id="modalWasteCustom"
                    placeholder={modalWasteReasonPreset === "Other" ? "Explain waste reason..." : "Additional details..."}
                    value={modalWasteReasonCustom}
                    onChange={(e) => setModalWasteReasonCustom(e.target.value)}
                    required={modalWasteReasonPreset === "Other"}
                    disabled={busy}
                  />
                </div>

                <div className="field full">
                  <label htmlFor="modalWasteTime">Occurred at</label>
                  <input
                    id="modalWasteTime"
                    type="datetime-local"
                    value={modalWasteOccurredAt}
                    onChange={(e) => setModalWasteOccurredAt(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
              </div>

              {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
              <div className="dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Trash2 aria-hidden="true" />}
                  Record waste
                </button>
              </div>
            </form>
          );
        })()}

        {modal === "correction" && (() => {
          const prod = state.products.find((p) => p.id === modalProductId);
          const batches = prod?.batches ?? [];
          const bat = batches.find((b) => b.id === modalBatchId);
          const countNum = Number(modalCorrCount);
          const diff = bat && modalCorrCount.trim() !== "" && Number.isFinite(countNum)
            ? Math.round((countNum - bat.quantity) * 10000) / 10000
            : null;

          return (
            <form onSubmit={submitCorrectionModal} noValidate>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="modalCorrProduct">Product</label>
                  <select
                    id="modalCorrProduct"
                    value={modalProductId}
                    onChange={(e) => {
                      const nextPid = e.target.value;
                      setModalProductId(nextPid);
                      const nextProd = state.products.find((p) => p.id === nextPid);
                      setModalBatchId(nextProd?.batches[0]?.id ?? "");
                    }}
                    required
                    disabled={busy || Boolean(selectedInventory)}
                  >
                    <option value="">Select product</option>
                    {state.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="modalCorrBatch">Batch</label>
                  <select
                    id="modalCorrBatch"
                    value={modalBatchId}
                    onChange={(e) => setModalBatchId(e.target.value)}
                    required
                    disabled={busy || !prod || Boolean(selectedInventory)}
                  >
                    <option value="">Select batch</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} · {b.quantity} {prod?.unit}
                      </option>
                    ))}
                  </select>
                </div>

                {bat && (
                  <div className="field full">
                    <div className="summary-box" style={{ margin: 0 }}>
                      <div className="summary-title">{prod?.name} · Batch {bat.id}</div>
                      <div className="summary-meta mono">
                        Recorded stock: <strong>{bat.quantity} {prod?.unit}</strong> · Expires {dateLabel(bat.expiryDate)}
                      </div>
                      {diff !== null && (
                        <div style={{ marginTop: "6px", fontSize: "12px", fontWeight: 600, color: diff < 0 ? "#a04000" : diff > 0 ? "#196f3d" : "#4a515c" }}>
                          {diff === 0
                            ? "No discrepancy (count matches recorded stock)"
                            : diff < 0
                            ? `Discrepancy: ${diff} ${prod?.unit} (stock decreases by ${Math.abs(diff)} ${prod?.unit})`
                            : `Discrepancy: +${diff} ${prod?.unit} (stock increases by ${diff} ${prod?.unit})`}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="modalCorrCount">
                    Actual physical shelf count {prod ? `(${prod.unit})` : ""}
                  </label>
                  <input
                    id="modalCorrCount"
                    type="number"
                    step="any"
                    min="0"
                    value={modalCorrCount}
                    onChange={(e) => setModalCorrCount(e.target.value)}
                    placeholder="e.g. 18"
                    required
                    disabled={busy}
                  />
                </div>

                <div className="field">
                  <label htmlFor="modalCorrCost">
                    Verified unit cost <span className="optional">(optional)</span>
                  </label>
                  <input
                    id="modalCorrCost"
                    inputMode="decimal"
                    placeholder="e.g. 2.10"
                    value={modalCorrCost}
                    onChange={(e) => setModalCorrCost(e.target.value)}
                    disabled={busy}
                  />
                  <span className="field-hint">In MYR. Leave blank if unverified.</span>
                </div>

                <div className="field">
                  <label htmlFor="modalCorrPreset">Correction reason</label>
                  <select
                    id="modalCorrPreset"
                    value={modalCorrReasonPreset}
                    onChange={(e) => setModalCorrReasonPreset(e.target.value)}
                    disabled={busy}
                  >
                    <option value="Physical stock-take discrepancy">Physical stock-take discrepancy</option>
                    <option value="Misplaced inventory located">Misplaced inventory located</option>
                    <option value="Unrecorded shrinkage / missing">Unrecorded shrinkage / missing</option>
                    <option value="Receiving count error correction">Receiving count error correction</option>
                    <option value="Data entry mistake correction">Data entry mistake correction</option>
                    <option value="Other">Other reason (specify below)</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="modalCorrCustom">
                    Reason explanation <span className="optional">(mandatory)</span>
                  </label>
                  <input
                    id="modalCorrCustom"
                    placeholder="Detailed explanation of discrepancy..."
                    value={modalCorrReasonCustom}
                    onChange={(e) => setModalCorrReasonCustom(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>

                <div className="field full">
                  <label htmlFor="modalCorrTime">Occurred at</label>
                  <input
                    id="modalCorrTime"
                    type="datetime-local"
                    value={modalCorrOccurredAt}
                    onChange={(e) => setModalCorrOccurredAt(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
              </div>

              {formError && <div className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{formError}</div>}
              <div className="dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? <LoaderCircle aria-hidden="true" className="spin" /> : <Check aria-hidden="true" />}
                  Record stock correction
                </button>
              </div>
            </form>
          );
        })()}
      </div>
    </div>}

    <div className="toast-region" aria-live="polite">
      {toast && <div className={`toast ${toastError ? "error" : ""}`} role="status">{toastError ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}{toast}</div>}
    </div>
  </div>;
}

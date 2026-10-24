"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FileUp,
  Info,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import type { AppState, InvoiceProposal, InvoiceProposalInput, StateResponse } from "@/src/lib/types";
import type { InvoiceCorrection, InvoiceHeader, InvoiceReceipt, OperationsResponse, Supplier } from "@/src/lib/operational-types";
import styles from "./InvoiceReceivingPanel.module.css";

type ProcessingStatus = "processing" | "review" | "failed" | "cancelled";
type ProductionProposal = InvoiceProposal & {
  unitPriceMinor?: number;
  taxMinor?: number;
  receivedQuantity?: number;
  localManual?: boolean;
};

type ProductionIntake = AppState["invoiceIntakes"][number] & {
  header?: InvoiceHeader;
  receipts?: InvoiceReceipt[];
  corrections?: InvoiceCorrection[];
  processingStatus?: ProcessingStatus;
  processingError?: string;
  proposals: ProductionProposal[];
};

type ProposalDraft = {
  productName: string;
  sku: string;
  category: string;
  quantity: string;
  unit: string;
  batchId: string;
  expiryDate: string;
  expiryNotApplicable: boolean;
  matchedProductId: string;
  matchMode: "existing" | "new";
  unitPrice: string;
  tax: string;
  receiveQuantity: string;
  receiveSelected: boolean;
};

type ApiError = { error?: string; message?: string };

type ModalState =
  | { type: "discard"; intake: ProductionIntake; proposal: ProductionProposal }
  | { type: "cancel"; intake: ProductionIntake }
  | { type: "receive_confirm"; intake: ProductionIntake; count: number }
  | null;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const result = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(result.error || result.message || `Request failed (${response.status}).`);
  return result;
}

function minorToDecimal(value?: number) {
  return value === undefined ? "" : (value / 100).toFixed(2);
}

function decimalToMinor(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter a valid amount with no more than two decimal places.");
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Amount is too large.");
  return result;
}

function initialDraft(proposal: ProductionProposal): ProposalDraft {
  return {
    productName: proposal.productName ?? "",
    sku: proposal.sku ?? "",
    category: proposal.category ?? "",
    quantity: proposal.quantity == null ? "" : String(proposal.quantity),
    unit: proposal.unit ?? "",
    batchId: proposal.batchId ?? "",
    expiryDate: proposal.expiryDate ?? "",
    expiryNotApplicable: false,
    matchedProductId: proposal.matchedProductId ?? "",
    matchMode: proposal.matchedProductId ? "existing" : "new",
    unitPrice: minorToDecimal(proposal.unitPriceMinor),
    tax: minorToDecimal(proposal.taxMinor),
    receiveQuantity: proposal.quantity == null ? "" : String(proposal.quantity),
    receiveSelected: proposal.status === "confirmed",
  };
}

function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value || "Date unavailable"
    : parsed.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}

function clean(value: string) {
  return value.trim();
}

export function InvoiceReceivingPanel({ state, onChanged }: { state: AppState; onChanged: () => void }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRetry = useRef<{ key: string; requestId: string } | null>(null);
  const receiptRetryIds = useRef<Record<string, string>>({});
  const intakes = state.invoiceIntakes as ProductionIntake[];

  const [drafts, setDrafts] = useState<Record<string, ProposalDraft>>({});
  const [manualLines, setManualLines] = useState<Record<string, ProductionProposal[]>>({});
  const [headerDrafts, setHeaderDrafts] = useState<Record<string, InvoiceHeader>>({});
  const [headerAmounts, setHeaderAmounts] = useState<Record<string, { tax: string; total: string }>>({});
  const [discrepancyReasons, setDiscrepancyReasons] = useState<Record<string, string>>({});

  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [supplierDrawerOpen, setSupplierDrawerOpen] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);

  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [uploadExpanded, setUploadExpanded] = useState(false);
  const [expandedInvoices, setExpandedInvoices] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);

  function toggleInvoiceExpanded(intakeId: string) {
    setExpandedInvoices((current) => ({
      ...current,
      [intakeId]: !current[intakeId],
    }));
  }

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);

  // In-app interactive modal state
  const [modalState, setModalState] = useState<ModalState>(null);
  const [modalReasonInput, setModalReasonInput] = useState("");

  const products = useMemo(() => [...state.products].sort((a, b) => a.name.localeCompare(b.name)), [state.products]);

  const intakeWithDrafts = useMemo(
    () =>
      intakes.map((intake) => ({
        ...intake,
        proposals: [...intake.proposals, ...(manualLines[intake.id] ?? [])].map((proposal) => ({
          ...proposal,
          draft: drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal),
        })),
      })),
    [intakes, drafts, manualLines],
  );

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const result = await request<OperationsResponse>("/api/operations");
      setSupplierList(result.suppliers ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load supplier records.");
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  function patchDraft(intakeId: string, proposal: ProductionProposal, patch: Partial<ProposalDraft>) {
    const key = `${intakeId}:${proposal.id}`;
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? initialDraft(proposal)), ...patch },
    }));
    setError("");
  }

  function toggleLineExpanded(lineKey: string) {
    setExpandedLines((current) => ({ ...current, [lineKey]: !current[lineKey] }));
  }

  function addManualLine(intake: ProductionIntake) {
    const proposal: ProductionProposal = {
      id: `manual-${crypto.randomUUID()}`,
      status: "pending",
      issues: ["Manually added; verify all invoice fields."],
      productName: "",
      sku: "",
      category: "",
      quantity: null,
      unit: "",
      batchId: "",
      expiryDate: "",
      localManual: true,
    };
    setManualLines((current) => ({ ...current, [intake.id]: [...(current[intake.id] ?? []), proposal] }));
    setExpandedLines((current) => ({ ...current, [`${intake.id}:${proposal.id}`]: true }));
  }

  function currentHeader(intake: ProductionIntake): InvoiceHeader {
    return headerDrafts[intake.id] ?? { ...(intake.header ?? {}) };
  }

  function updateHeader(intakeId: string, patch: Partial<InvoiceHeader>, intake: ProductionIntake) {
    setHeaderDrafts((current) => ({ ...current, [intakeId]: { ...currentHeader(intake), ...patch } }));
    setError("");
  }

  async function applyStateResponse() {
    onChanged();
  }

  async function upload(file?: File) {
    if (!file) return;
    setUploadError("");
    const allowed = [".pdf", ".csv", ".png", ".jpg", ".jpeg"];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowed.includes(ext)) {
      setUploadError("Choose a PDF, CSV, PNG, or JPEG file.");
      return;
    }
    const retryKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (!uploadRetry.current || uploadRetry.current.key !== retryKey) {
      uploadRetry.current = { key: retryKey, requestId: crypto.randomUUID() };
    }
    const body = new FormData();
    body.append("file", file);
    body.append("requestId", uploadRetry.current.requestId);
    setUploading(true);
    try {
      const result = await request<StateResponse>("/api/invoices", { method: "POST", body });
      uploadRetry.current = null;
      const uploadedIntakes = result.state.invoiceIntakes as ProductionIntake[];
      const uploaded = uploadedIntakes
        .filter((intake) => intake.fileName === file.name)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
      setUploadExpanded(false);
      if (uploaded?.id) {
        setExpandedInvoices((current) => ({ ...current, [uploaded.id]: true }));
      }
      if (uploaded?.processingStatus === "failed") {
        setSuccess("Invoice file uploaded and retained. No stock has changed; you can enter lines manually or retry.");
        setUploadError(uploaded.processingError || "Processing failed. The document remains available for review.");
      } else if (uploaded?.processingStatus === "processing") {
        setSuccess("Invoice uploaded and processing has started. No stock has changed.");
      } else {
        setSuccess("Invoice uploaded to review. No stock has changed.");
      }
      await applyStateResponse();
    } catch (cause) {
      setUploadError(
        cause instanceof Error ? cause.message : "Invoice upload failed. Retry with the same file to reuse its request reference.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void upload(e.dataTransfer.files[0]);
    }
  }

  function proposalInput(draft: ProposalDraft): InvoiceProposalInput {
    return {
      productName: clean(draft.productName),
      sku: clean(draft.sku),
      category: clean(draft.category),
      quantity: draft.quantity.trim() ? Number(draft.quantity) : null,
      unit: clean(draft.unit),
      batchId: clean(draft.batchId),
      expiryDate: clean(draft.expiryDate),
      ...(draft.matchMode === "existing" && draft.matchedProductId ? { matchedProductId: draft.matchedProductId } : {}),
    };
  }

  function validateProposal(draft: ProposalDraft, forReceiving: boolean) {
    const fields = proposalInput(draft);
    if (draft.quantity.trim() && (!Number.isFinite(fields.quantity) || Number(fields.quantity) <= 0)) {
      throw new Error("Invoiced quantity must be a positive number.");
    }
    decimalToMinor(draft.unitPrice);
    decimalToMinor(draft.tax);
    if (!forReceiving) return fields;
    if (!draft.matchMode) throw new Error("Choose an existing product or a new product.");
    if (!fields.productName || !fields.sku || !fields.unit) {
      throw new Error("Product name, SKU, and unit must be verified before receiving.");
    }
    if (
      draft.matchMode === "existing" &&
      (!draft.matchedProductId || !products.some((product) => product.id === draft.matchedProductId))
    ) {
      throw new Error("Choose a verified existing product.");
    }
    if (draft.matchMode === "new" && !fields.category) throw new Error("A category is required for a new product.");
    if (!fields.batchId) throw new Error("A real batch ID is required; it is never generated automatically.");
    if (
      forReceiving &&
      !draft.expiryNotApplicable &&
      (!fields.expiryDate || Number.isNaN(new Date(`${fields.expiryDate}T00:00:00`).getTime()))
    ) {
      throw new Error("Enter a verified expiry date or explicitly mark expiry as not applicable.");
    }
    return fields;
  }

  async function saveReview(intake: ProductionIntake) {
    const header = currentHeader(intake);
    setBusy(`save-${intake.id}`);
    setError("");
    setSuccess("");
    try {
      const amounts = headerAmounts[intake.id];
      const taxMinor = amounts ? decimalToMinor(amounts.tax) : header.taxMinor;
      const totalMinor = amounts ? decimalToMinor(amounts.total) : header.totalMinor;
      const lines = intake.proposals
        .filter((proposal) => proposal.status === "pending")
        .map((proposal) => {
          const draft = drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal);
          const fields = validateProposal(draft, false);
          return {
            proposalId: proposal.id,
            fields,
            ...(decimalToMinor(draft.unitPrice) === undefined ? {} : { unitPriceMinor: decimalToMinor(draft.unitPrice) }),
            ...(decimalToMinor(draft.tax) === undefined ? {} : { taxMinor: decimalToMinor(draft.tax) }),
          };
        });
      await request<StateResponse>("/api/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "update_invoice",
          payload: { intakeId: intake.id, reason: "Invoice details reviewed", header: { ...header, taxMinor, totalMinor }, lines },
        }),
      });
      setSuccess("Review edits saved. No stock was received.");
      setDrafts((current) => {
        const next = { ...current };
        intake.proposals.forEach((proposal) => {
          delete next[`${intake.id}:${proposal.id}`];
        });
        return next;
      });
      setManualLines((current) => {
        const next = { ...current };
        delete next[intake.id];
        return next;
      });
      setHeaderDrafts((current) => {
        const next = { ...current };
        delete next[intake.id];
        return next;
      });
      setHeaderAmounts((current) => {
        const next = { ...current };
        delete next[intake.id];
        return next;
      });
      await applyStateResponse();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save invoice review.");
    } finally {
      setBusy("");
    }
  }

  function openReceiveConfirm(intake: ProductionIntake) {
    const receivable = intake.proposals.filter((proposal) => {
      const draft = drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal);
      return (
        !proposal.id.startsWith("manual-") &&
        (proposal.status === "pending" || proposal.status === "confirmed") &&
        draft.receiveSelected &&
        (proposal.quantity ?? 0) > receivedTotal(intake, proposal)
      );
    });
    if (!receivable.length) {
      setError("Please select at least one unreceived item line with the checkbox to receive.");
      return;
    }
    setModalState({ type: "receive_confirm", intake, count: receivable.length });
  }

  async function executeReceive(intake: ProductionIntake) {
    setError("");
    setSuccess("");
    setModalState(null);
    const pending = intake.proposals.filter((proposal) => {
      const draft = drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal);
      return (
        !proposal.id.startsWith("manual-") &&
        (proposal.status === "pending" || proposal.status === "confirmed") &&
        draft.receiveSelected &&
        (proposal.quantity ?? 0) > receivedTotal(intake, proposal)
      );
    });
    setBusy(`receive-${intake.id}`);
    try {
      const lines = pending.map((proposal) => {
        const draft = drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal);
        const fields = validateProposal(draft, true);
        const remaining = (proposal.quantity ?? 0) - receivedTotal(intake, proposal);
        const quantity = Number(drafts[`${intake.id}:${proposal.id}`]?.receiveQuantity ?? remaining);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) {
          throw new Error(
            `${proposal.productName || "Line"}: physical quantity must be positive and no greater than remaining invoiced quantity (${remaining}).`,
          );
        }
        return {
          proposalId: proposal.id,
          quantity,
          batchId: fields.batchId,
          expiryDate: draft.expiryNotApplicable ? "" : fields.expiryDate,
          ...(draft.expiryNotApplicable ? { expiryNotApplicable: true } : {}),
          matchMode: draft.matchMode,
          fields,
          ...(decimalToMinor(draft.unitPrice) === undefined ? {} : { unitCostMinor: decimalToMinor(draft.unitPrice) }),
        };
      });
      const requestId = receiptRetryIds.current[intake.id] ?? crypto.randomUUID();
      receiptRetryIds.current[intake.id] = requestId;
      await request<StateResponse>("/api/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "receive_invoice",
          payload: {
            intakeId: intake.id,
            requestId,
            confirmed: true,
            ...(clean(discrepancyReasons[intake.id] ?? "") ? { discrepancyReason: clean(discrepancyReasons[intake.id]) } : {}),
            lines,
          },
        }),
      });
      delete receiptRetryIds.current[intake.id];
      setSuccess("Physical receipt recorded! Stock has been posted to inventory.");
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        new BroadcastChannel("freshflow-stored-state").postMessage("changed");
      }
      setDrafts((current) => {
        const next = { ...current };
        pending.forEach((proposal) => {
          delete next[`${intake.id}:${proposal.id}`];
        });
        return next;
      });
      await applyStateResponse();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not receive these invoice lines.");
    } finally {
      setBusy("");
    }
  }

  async function executeDiscard(intake: ProductionIntake, proposal: ProductionProposal, reason: string) {
    if (!clean(reason)) {
      setError("A reason is required to discard an invoice line.");
      return;
    }
    const busyKey = `discard-${intake.id}-${proposal.id}`;
    setBusy(busyKey);
    setModalState(null);
    setError("");
    setSuccess("");
    try {
      await request<StateResponse>("/api/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "discard_line",
          payload: { intakeId: intake.id, proposalId: proposal.id, reason: clean(reason) },
        }),
      });
      setSuccess(`Invoice line "${proposal.productName || proposal.id}" was discarded.`);
      setDrafts((current) => {
        const next = { ...current };
        delete next[`${intake.id}:${proposal.id}`];
        return next;
      });
      await applyStateResponse();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not discard this invoice line.");
    } finally {
      setBusy("");
    }
  }

  async function executeCancelInvoice(intake: ProductionIntake, reason: string) {
    if (!clean(reason)) {
      setError("A cancellation reason is required.");
      return;
    }
    setBusy(`cancel-${intake.id}`);
    setModalState(null);
    setError("");
    setSuccess("");
    try {
      await request<StateResponse>("/api/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cancel_invoice", payload: { intakeId: intake.id, reason: clean(reason) } }),
      });
      setSuccess(`Invoice ${intake.fileName} was cancelled and removed.`);
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        new BroadcastChannel("freshflow-stored-state").postMessage("changed");
      }
      setExpandedInvoices((current) => {
        const next = { ...current };
        delete next[intake.id];
        return next;
      });
      await applyStateResponse();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel this invoice.");
    } finally {
      setBusy("");
    }
  }

  function receivedTotal(intake: ProductionIntake, proposal: ProductionProposal) {
    const fromReceipts = (intake.receipts ?? []).reduce(
      (sum, receipt) =>
        sum +
        receipt.lines.reduce((lineSum, line) => lineSum + (line.proposalId === proposal.id ? line.quantity : 0), 0),
      0,
    );
    return fromReceipts || proposal.receivedQuantity || 0;
  }

  async function retryProcessing(intake: ProductionIntake) {
    setBusy(`retry-${intake.id}`);
    setError("");
    setSuccess("");
    try {
      await request<StateResponse>("/api/receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "retry_processing", payload: { intakeId: intake.id } }),
      });
      setSuccess("Invoice extraction restarted.");
      await applyStateResponse();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retry invoice processing.");
    } finally {
      setBusy("");
    }
  }

  async function addSupplier(event: FormEvent) {
    event.preventDefault();
    setSavingSupplier(true);
    setError("");
    setSuccess("");
    try {
      const result = await request<OperationsResponse>("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save_supplier",
          payload: {
            name: clean(supplierName),
            ...(clean(supplierReference) ? { reference: clean(supplierReference) } : {}),
          },
        }),
      });
      setSupplierList(result.suppliers ?? []);
      setSupplierName("");
      setSupplierReference("");
      setSuccess(`Supplier "${clean(supplierName)}" saved.`);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save supplier.");
    } finally {
      setSavingSupplier(false);
    }
  }

  const reviewCount = intakes.filter((i) => i.status === "review" || i.processingStatus === "review").length;
  const completedCount = intakes.filter((i) => i.status === "completed").length;

  return (
    <div className={styles.panel}>
      {/* Top Overview Banner */}
      <div className={styles.banner}>
        <div className={styles.bannerInfo}>
          <h2 className={styles.bannerTitle}>Supplier Invoice Intake & Receiving</h2>
          <p className={styles.bannerSubtitle}>
            Upload invoices, match products with your catalog, and confirm physical deliveries to update inventory stock.
          </p>
        </div>
        <div className={styles.bannerStats}>
          <div className={styles.statPill}>
            <span className={styles.statPillLabel}>Pending Review</span>
            <span className={styles.statPillValue}>{reviewCount}</span>
          </div>
          <div className={styles.statPill}>
            <span className={styles.statPillLabel}>Completed</span>
            <span className={styles.statPillValue}>{completedCount}</span>
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setUploadExpanded(!uploadExpanded)}
          >
            <FileUp size={15} />
            {uploadExpanded ? "Close Upload Form" : "Upload New Invoice"}
          </button>
        </div>
      </div>

      {/* Collapsible Drag & Drop Upload Zone */}
      {uploadExpanded && (
        <div className={styles.uploadDrawer}>
          <div className={styles.uploadDrawerHead}>
            <div className={styles.uploadDrawerTitle}>Upload Supplier Invoice</div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              onClick={() => setUploadExpanded(false)}
              aria-label="Close upload form"
            >
              <X size={15} /> Close
            </button>
          </div>
          <div
            className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv,.png,.jpg,.jpeg,application/pdf,text/csv,image/png,image/jpeg"
              hidden
              onChange={(e) => void upload(e.target.files?.[0])}
              aria-label="Upload invoice file"
            />
            <div className={styles.dropzoneIconWrapper}>
              {uploading ? <LoaderCircle className="spin" size={24} /> : <UploadCloud size={24} />}
            </div>
            <div className={styles.dropzonePrompt}>
              {uploading ? (
                "Uploading & parsing invoice..."
              ) : (
                <>
                  Drag and drop an invoice here, or <span className={styles.dropzoneHighlight}>browse files</span>
                </>
              )}
            </div>
            <p className={styles.dropzoneSubtext}>
              Supports PDF, CSV, PNG, or JPEG (up to 5MB). Upload creates a safe review draft without altering stock.
            </p>
            <div className={styles.formatBadges}>
              <span className={styles.formatBadge}>PDF</span>
              <span className={styles.formatBadge}>CSV</span>
              <span className={styles.formatBadge}>PNG</span>
              <span className={styles.formatBadge}>JPEG</span>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Section Accordion */}
      <div className={styles.supplierSection}>
        <div className={styles.supplierHeader} onClick={() => setSupplierDrawerOpen(!supplierDrawerOpen)}>
          <div className={styles.supplierHeaderTitle}>
            <Building2 size={16} />
            <span>Supplier Directory & Matching</span>
            <span className={styles.supplierCountBadge}>{supplierList.length} registered</span>
          </div>
          {supplierDrawerOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>

        {supplierDrawerOpen && (
          <div className={styles.supplierBody}>
            <form onSubmit={(e) => void addSupplier(e)} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className={styles.formField} style={{ flex: "1 1 200px" }}>
                <label className={styles.formLabel} htmlFor={`${id}-supp-name`}>Supplier Name</label>
                <input
                  id={`${id}-supp-name`}
                  className={styles.formInput}
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. F&N Dairies Malaysia Sdn Bhd"
                  required
                />
              </div>
              <div className={styles.formField} style={{ flex: "1 1 180px" }}>
                <label className={styles.formLabel} htmlFor={`${id}-supp-ref`}>Account / Vendor Reference (Optional)</label>
                <input
                  id={`${id}-supp-ref`}
                  className={styles.formInput}
                  value={supplierReference}
                  onChange={(e) => setSupplierReference(e.target.value)}
                  placeholder="e.g. ACC-88412"
                />
              </div>
              <button
                type="submit"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={savingSupplier || !supplierName.trim()}
              >
                {savingSupplier ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                {savingSupplier ? "Saving..." : "Add Supplier"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Error & Success Messages */}
      {uploadError && (
        <div className={`${styles.feedback} ${styles.errorBanner}`} role="alert">
          <AlertTriangle size={16} />
          <span>{uploadError}</span>
        </div>
      )}
      {error && (
        <div className={`${styles.feedback} ${styles.errorBanner}`} role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className={`${styles.feedback} ${styles.successBanner}`} role="status">
          <CheckCircle2 size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* Invoice Cards List */}
      {intakeWithDrafts.length > 0 ? (
        intakeWithDrafts.map((intake) => {
          const header = currentHeader(intake);
          const status = intake.processingStatus ?? intake.status ?? "review";
          const hasPendingReview = intake.proposals.some((p) => p.status === "pending");
          const hasReceivable = intake.proposals.some(
            (p) => (p.status === "pending" || p.status === "confirmed") && (p.quantity ?? 0) > receivedTotal(intake, p),
          );
          const hasReceipts = (intake.receipts?.length ?? 0) > 0 || intake.proposals.some((p) => (p.receivedQuantity ?? 0) > 0);
          const isInvoiceExpanded = Boolean(expandedInvoices[intake.id]);
          const totalReceivedLines = intake.proposals.filter(
            (p) => receivedTotal(intake, p) >= (p.quantity ?? 0) && (p.quantity ?? 0) > 0,
          ).length;

          return (
            <div className={styles.invoiceCard} key={intake.id}>
              {/* Card Header (Collapsible Accordion Trigger) */}
              <div
                className={`${styles.invoiceCardHeader} ${styles.clickableHeader}`}
                onClick={() => toggleInvoiceExpanded(intake.id)}
              >
                <div className={styles.invoiceTitleGroup}>
                  <div className={`${styles.chevronIcon} ${isInvoiceExpanded ? styles.chevronExpanded : ""}`}>
                    <ChevronRight size={18} />
                  </div>
                  <div className={styles.invoiceDocIcon}>
                    <FileText size={20} />
                  </div>
                  <div>
                    <div className={styles.invoiceFileName}>{intake.fileName}</div>
                    <div className={styles.cardSummaryMetrics}>
                      <span className={styles.invoiceMetaText}>
                        Uploaded {dateLabel(intake.uploadedAt)}
                      </span>
                      <span className={styles.metricChip}>
                        {intake.proposals.length} item line{intake.proposals.length === 1 ? "" : "s"}
                      </span>
                      {header.totalMinor != null && header.totalMinor > 0 && (
                        <span className={styles.metricChip}>
                          RM {(header.totalMinor / 100).toFixed(2)}
                        </span>
                      )}
                      <span className={styles.metricChip}>
                        {totalReceivedLines}/{intake.proposals.length} received
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
                  <span
                    className={`${styles.statusBadge} ${
                      status === "review"
                        ? styles.badgeReview
                        : status === "completed"
                        ? styles.badgeCompleted
                        : status === "partial"
                        ? styles.badgePartial
                        : status === "processing"
                        ? styles.badgeProcessing
                        : styles.badgeFailed
                    }`}
                  >
                    {status === "review" ? "Review Draft" : status}
                  </span>

                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                    onClick={() => toggleInvoiceExpanded(intake.id)}
                  >
                    {isInvoiceExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {isInvoiceExpanded ? "Collapse" : "Review"}
                  </button>

                  {hasReceivable && status !== "processing" && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                      disabled={!!busy}
                      onClick={() => openReceiveConfirm(intake)}
                    >
                      <Check size={13} /> Receive
                    </button>
                  )}

                  <a
                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                    href={`/api/invoices/${encodeURIComponent(intake.id)}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View Original
                  </a>

                  {status === "failed" && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                      disabled={!!busy}
                      onClick={() => void retryProcessing(intake)}
                    >
                      <RefreshCw size={14} /> Retry
                    </button>
                  )}

                  {status !== "cancelled" && !hasReceipts && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                      disabled={!!busy}
                      onClick={() => {
                        setModalReasonInput("");
                        setModalState({ type: "cancel", intake });
                      }}
                    >
                      <Trash2 size={13} /> Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Collapsible Invoice Review & Receiving Body */}
              {isInvoiceExpanded && (
                <>
                  {/* Sample Extraction Notice */}
                  <div className={styles.sampleNotice}>
                    <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <strong>Sample extraction results (prototype simulated extraction)</strong>: Please verify all fields, quantities, units, and dates against your physical invoice before confirming receiving.
                    </div>
                  </div>

                  {/* Duplicate Upload Warning if detected */}
                  {intake.warnings && intake.warnings.length > 0 && (
                    intake.warnings.map((warn, wIdx) => (
                      <div key={wIdx} className={styles.duplicateNotice}>
                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                        <div>
                          <strong>Notice:</strong> {warn}
                        </div>
                      </div>
                    ))
                  )}

              {/* Invoice Metadata Grid */}
              <div className={styles.invoiceMetadataGrid}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor={`${id}-${intake.id}-supp`}>
                    Supplier
                  </label>
                  <select
                    id={`${id}-${intake.id}-supp`}
                    className={styles.formSelect}
                    value={header.supplierId ?? ""}
                    onChange={(e) =>
                      updateHeader(
                        intake.id,
                        {
                          supplierId: e.target.value || undefined,
                          supplierName: supplierList.find((s) => s.id === e.target.value)?.name,
                        },
                        intake,
                      )
                    }
                  >
                    <option value="">No verified supplier selected</option>
                    {supplierList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.reference ? `(${s.reference})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor={`${id}-${intake.id}-no`}>
                    Invoice Number
                  </label>
                  <input
                    id={`${id}-${intake.id}-no`}
                    className={styles.formInput}
                    value={header.invoiceNumber ?? ""}
                    onChange={(e) => updateHeader(intake.id, { invoiceNumber: e.target.value }, intake)}
                    placeholder="e.g. INV-2026-0042"
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor={`${id}-${intake.id}-dt`}>
                    Invoice Date
                  </label>
                  <input
                    id={`${id}-${intake.id}-dt`}
                    className={styles.formInput}
                    type="date"
                    value={header.invoiceDate ?? ""}
                    onChange={(e) => updateHeader(intake.id, { invoiceDate: e.target.value }, intake)}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor={`${id}-${intake.id}-total`}>
                    Total Amount (MYR)
                  </label>
                  <input
                    id={`${id}-${intake.id}-total`}
                    className={styles.formInput}
                    placeholder="0.00"
                    value={headerAmounts[intake.id]?.total ?? minorToDecimal(header.totalMinor)}
                    onChange={(e) => {
                      setHeaderAmounts((current) => ({
                        ...current,
                        [intake.id]: {
                          total: e.target.value,
                          tax: current[intake.id]?.tax ?? minorToDecimal(header.taxMinor),
                        },
                      }));
                      setError("");
                    }}
                  />
                </div>
              </div>

              {/* Line Items Container */}
              <div className={styles.linesContainer}>
                <div className={styles.linesHeader}>
                  <div className={styles.linesHeading}>Invoice Items & Verification</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                      {intake.proposals.length} item(s) detected
                    </div>
                    {status !== "cancelled" && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                        disabled={status === "processing"}
                        onClick={() => addManualLine(intake)}
                      >
                        <Plus size={14} /> Add Line
                      </button>
                    )}
                  </div>
                </div>

                {intake.proposals.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center", color: "var(--text-tertiary)" }}>
                    No invoice lines extracted. Click &quot;Add Line&quot; to manually add stock items.
                  </div>
                ) : (
                  intake.proposals.map((proposal) => {
                    const draft = proposal.draft;
                    const lineKey = `${intake.id}:${proposal.id}`;
                    const isExpanded = !!expandedLines[lineKey];
                    const received = receivedTotal(intake, proposal);
                    const remaining = Math.max(0, (proposal.quantity ?? 0) - received);
                    const matched = products.find((p) => p.id === draft.matchedProductId);
                    const receiveQty = drafts[lineKey]?.receiveQuantity || String(remaining);

                    return (
                      <div
                        key={proposal.id}
                        className={`${styles.lineItemCard} ${isExpanded ? styles.lineItemCardActive : ""}`}
                      >
                        {/* Summary Bar */}
                        <div className={styles.lineSummaryBar}>
                          <div className={styles.lineSummaryMain}>
                            {remaining > 0 && status !== "cancelled" && status !== "processing" && (
                              <input
                                type="checkbox"
                                className={styles.lineCheckbox}
                                checked={draft.receiveSelected}
                                onChange={(e) => patchDraft(intake.id, proposal, { receiveSelected: e.target.checked })}
                                title="Select for physical delivery receipt"
                              />
                            )}
                            <div onClick={() => toggleLineExpanded(lineKey)} style={{ cursor: "pointer", flex: 1 }}>
                              <div className={styles.lineProductName}>
                                {draft.productName || "Unidentified Item Line"}
                              </div>
                              <div className={styles.lineProductSub}>
                                SKU: {draft.sku || "Not specified"} · Category: {draft.category || "Unassigned"}
                              </div>
                            </div>
                          </div>

                          <div className={styles.lineMetrics} onClick={() => toggleLineExpanded(lineKey)}>
                            <div className={styles.metricBlock}>
                              <span className={styles.metricLabel}>Invoiced</span>
                              <span className={styles.metricValue}>
                                {proposal.quantity ?? "?"} {proposal.unit || "units"}
                              </span>
                            </div>
                            <div className={styles.metricBlock}>
                              <span className={styles.metricLabel}>Received</span>
                              <span className={styles.metricValue}>
                                {received} {proposal.unit || "units"}
                              </span>
                            </div>
                            <div className={styles.metricBlock}>
                              <span className={styles.metricLabel}>Remaining</span>
                              <span
                                className={styles.metricValue}
                                style={{ color: remaining > 0 ? "var(--accent, #059669)" : "var(--text-tertiary)" }}
                              >
                                {remaining} {proposal.unit || "units"}
                              </span>
                            </div>

                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLineExpanded(lineKey);
                              }}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {isExpanded ? "Close" : "Edit Details"}
                            </button>
                          </div>
                        </div>

                        {/* Detailed Edit Drawer */}
                        {isExpanded && (
                          <div className={styles.lineDetailsDrawer}>
                            {/* Auto-match Banner */}
                            {draft.matchMode === "existing" && matched && (
                              <div className={styles.matchBanner}>
                                <ShieldCheck size={16} />
                                <span>
                                  Matched Catalog Item: <strong>{matched.name}</strong> (SKU: {matched.sku}, Category: {matched.category})
                                </span>
                              </div>
                            )}

                            {proposal.issues.length > 0 && (
                              <div className={styles.issuesBanner}>
                                <AlertTriangle size={16} />
                                <span>Verification needed: {proposal.issues.join("; ")}</span>
                              </div>
                            )}

                            <div className={styles.lineGrid}>
                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Catalog Mapping</label>
                                <select
                                  className={styles.formSelect}
                                  value={draft.matchMode}
                                  onChange={(e) =>
                                    patchDraft(intake.id, proposal, {
                                      matchMode: e.target.value as "existing" | "new",
                                      matchedProductId: e.target.value === "new" ? "" : draft.matchedProductId,
                                    })
                                  }
                                >
                                  <option value="existing">Link to Existing Catalog Product</option>
                                  <option value="new">Create as New Product</option>
                                </select>
                              </div>

                              {draft.matchMode === "existing" && (
                                <div className={styles.formField}>
                                  <label className={styles.formLabel}>Catalog Product</label>
                                  <select
                                    className={styles.formSelect}
                                    value={draft.matchedProductId}
                                    onChange={(e) => {
                                      const p = products.find((item) => item.id === e.target.value);
                                      patchDraft(intake.id, proposal, {
                                        matchedProductId: e.target.value,
                                        ...(p
                                          ? { productName: p.name, sku: p.sku, category: p.category, unit: p.unit }
                                          : {}),
                                      });
                                    }}
                                  >
                                    <option value="">Select product from inventory</option>
                                    {products.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} · {p.sku} ({p.unit})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Product Name</label>
                                <input
                                  className={styles.formInput}
                                  value={draft.productName}
                                  onChange={(e) => patchDraft(intake.id, proposal, { productName: e.target.value })}
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>SKU Code</label>
                                <input
                                  className={styles.formInput}
                                  value={draft.sku}
                                  onChange={(e) => patchDraft(intake.id, proposal, { sku: e.target.value })}
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Category</label>
                                <input
                                  className={styles.formInput}
                                  value={draft.category}
                                  onChange={(e) => patchDraft(intake.id, proposal, { category: e.target.value })}
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Unit of Measure</label>
                                <input
                                  className={styles.formInput}
                                  value={draft.unit}
                                  onChange={(e) => patchDraft(intake.id, proposal, { unit: e.target.value })}
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Invoiced Quantity</label>
                                <input
                                  className={styles.formInput}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={draft.quantity}
                                  onChange={(e) => patchDraft(intake.id, proposal, { quantity: e.target.value })}
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Batch ID / Lot Number</label>
                                <input
                                  className={styles.formInput}
                                  value={draft.batchId}
                                  onChange={(e) => patchDraft(intake.id, proposal, { batchId: e.target.value })}
                                  placeholder="e.g. LOT-2026-X"
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Expiry Date</label>
                                <input
                                  className={styles.formInput}
                                  type="date"
                                  disabled={draft.expiryNotApplicable}
                                  value={draft.expiryDate}
                                  onChange={(e) => patchDraft(intake.id, proposal, { expiryDate: e.target.value })}
                                />
                              </div>

                              <div className={styles.formField}>
                                <label className={styles.formLabel}>Unit Cost (MYR)</label>
                                <input
                                  className={styles.formInput}
                                  placeholder="0.00"
                                  value={draft.unitPrice}
                                  onChange={(e) => patchDraft(intake.id, proposal, { unitPrice: e.target.value })}
                                />
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={draft.expiryNotApplicable}
                                  onChange={(e) => patchDraft(intake.id, proposal, { expiryNotApplicable: e.target.checked })}
                                />
                                Non-perishable / Expiry not applicable
                              </label>

                              {remaining > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>Physical qty received now:</span>
                                  <input
                                    className={styles.formInput}
                                    style={{ width: "90px", height: "30px" }}
                                    type="number"
                                    min="0"
                                    max={remaining}
                                    step="any"
                                    value={receiveQty}
                                    onChange={(e) => patchDraft(intake.id, proposal, { receiveQuantity: e.target.value })}
                                  />
                                  <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                                    (max {remaining} {proposal.unit})
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Discard button */}
                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                                disabled={
                                  !!busy ||
                                  proposal.status !== "pending" ||
                                  status === "cancelled" ||
                                  status === "processing"
                                }
                                onClick={() => {
                                  setModalReasonInput("");
                                  setModalState({ type: "discard", intake, proposal });
                                }}
                              >
                                <Trash2 size={13} /> Discard Item Line
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom Confirmation Bar */}
              <div className={styles.invoiceFooter}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 300px" }}>
                  {hasReceivable && (
                    <input
                      className={styles.formInput}
                      style={{ height: "34px", flex: 1 }}
                      value={discrepancyReasons[intake.id] ?? ""}
                      onChange={(e) => setDiscrepancyReasons((cur) => ({ ...cur, [intake.id]: e.target.value }))}
                      placeholder="Optional delivery discrepancy note (e.g. damaged box, short delivery)"
                    />
                  )}
                </div>

                <div className={styles.footerButtons}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={() => toggleInvoiceExpanded(intake.id)}
                  >
                    <ChevronDown size={14} /> Collapse
                  </button>

                  {hasPendingReview && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      disabled={!!busy}
                      onClick={() => void saveReview(intake)}
                    >
                      {busy === `save-${intake.id}` ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                      Save Review Edits
                    </button>
                  )}

                  {hasReceivable && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={!!busy}
                      onClick={() => openReceiveConfirm(intake)}
                    >
                      {busy === `receive-${intake.id}` ? <LoaderCircle size={14} className="spin" /> : <PackageCheck size={14} />}
                      Confirm Physical Delivery Receipt
                    </button>
                  )}

                  {status !== "cancelled" && !hasReceipts && (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      disabled={!!busy}
                      onClick={() => {
                        setModalReasonInput("");
                        setModalState({ type: "cancel", intake });
                      }}
                    >
                      <Trash2 size={14} /> Cancel Invoice
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      );
    })
  ) : (
    <div className={styles.emptyState}>
      <PackageCheck size={40} className={styles.emptyIcon} />
      <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, margin: 0 }}>No supplier invoices yet</h3>
      <p style={{ fontSize: "0.875rem", color: "var(--text-tertiary)", margin: 0, maxWidth: "420px" }}>
        Upload a supplier invoice (PDF, CSV, PNG, or JPEG) to extract item lines, match with your store catalog, and receive stock.
      </p>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        style={{ marginTop: "8px" }}
        onClick={() => setUploadExpanded(true)}
      >
        <FileUp size={15} /> Upload First Invoice
      </button>
    </div>
  )}

      {/* Accessible Interactive In-App Confirmation Modal */}
      {modalState && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                {modalState.type === "discard" && "Discard Invoice Line"}
                {modalState.type === "cancel" && "Cancel Pending Invoice"}
                {modalState.type === "receive_confirm" && "Confirm Physical Stock Receipt"}
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                onClick={() => setModalState(null)}
              >
                <X size={14} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {modalState.type === "discard" && (
                <>
                  <p>
                    Are you sure you want to discard <strong>&quot;{modalState.proposal.productName || "this item line"}&quot;</strong>?
                    This will be preserved in the audit correction history.
                  </p>
                  <div className={styles.formField}>
                    <label className={styles.formLabel} htmlFor="modal-discard-reason">
                      Reason for discarding
                    </label>
                    <input
                      id="modal-discard-reason"
                      className={styles.formInput}
                      value={modalReasonInput}
                      onChange={(e) => setModalReasonInput(e.target.value)}
                      placeholder="e.g. Item not delivered / returned to driver"
                      autoFocus
                    />
                  </div>
                </>
              )}

              {modalState.type === "cancel" && (
                <>
                  <p>
                    Are you sure you want to cancel and delete invoice <strong>&quot;{modalState.intake.fileName}&quot;</strong>?
                  </p>
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
                    This will permanently remove the pending intake record and delete its stored document. No inventory stock changes have occurred.
                  </p>
                  <div className={styles.formField}>
                    <label className={styles.formLabel} htmlFor="modal-cancel-reason">
                      Reason for cancellation (required)
                    </label>
                    <input
                      id="modal-cancel-reason"
                      className={styles.formInput}
                      value={modalReasonInput}
                      onChange={(e) => setModalReasonInput(e.target.value)}
                      placeholder="e.g. Duplicate upload / incorrect store order / vendor revised"
                      autoFocus
                    />
                  </div>
                </>
              )}

              {modalState.type === "receive_confirm" && (
                <>
                  <p>
                    Confirm physical receipt for <strong>{modalState.count} selected line(s)</strong> in &quot;{modalState.intake.fileName}&quot;?
                  </p>
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
                    This action will officially post batches and quantities to your live store inventory.
                  </p>
                </>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setModalState(null)}
              >
                Cancel
              </button>

              {modalState.type === "discard" && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  disabled={!modalReasonInput.trim()}
                  onClick={() => void executeDiscard(modalState.intake, modalState.proposal, modalReasonInput)}
                >
                  Confirm Discard
                </button>
              )}

              {modalState.type === "cancel" && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  disabled={!modalReasonInput.trim()}
                  onClick={() => void executeCancelInvoice(modalState.intake, modalReasonInput)}
                >
                  <Trash2 size={14} /> Cancel & Delete Invoice
                </button>
              )}

              {modalState.type === "receive_confirm" && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => void executeReceive(modalState.intake)}
                >
                  <PackageCheck size={14} /> Confirm & Post to Inventory
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

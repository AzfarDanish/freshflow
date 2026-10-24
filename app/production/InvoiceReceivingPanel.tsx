"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, Check, FileText, FileUp, LoaderCircle, PackageCheck, Plus, RefreshCw, Save, X } from "lucide-react";
import type { AppState, InvoiceProposal, InvoiceProposalInput, StateResponse } from "@/src/lib/types";
import type { InvoiceCorrection, InvoiceHeader, InvoiceReceipt, OperationsResponse, Supplier } from "@/src/lib/operational-types";
import styles from "./ProductionPanels.module.css";

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const result = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(result.error || result.message || `Request failed (${response.status}).`);
  return result;
}
function minorToDecimal(value?: number) { return value === undefined ? "" : (value / 100).toFixed(2); }
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
    productName: proposal.productName ?? "", sku: proposal.sku ?? "", category: proposal.category ?? "",
    quantity: proposal.quantity == null ? "" : String(proposal.quantity), unit: proposal.unit ?? "",
    batchId: proposal.batchId ?? "", expiryDate: proposal.expiryDate ?? "",
    expiryNotApplicable: false,
    matchedProductId: proposal.matchedProductId ?? "", matchMode: proposal.matchedProductId ? "existing" : "new",
    unitPrice: minorToDecimal(proposal.unitPriceMinor), tax: minorToDecimal(proposal.taxMinor),
    receiveQuantity: proposal.quantity == null ? "" : String(proposal.quantity),
    receiveSelected: proposal.status === "confirmed",
  };
}
function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value || "Date unavailable" : parsed.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}
function clean(value: string) { return value.trim(); }

/** state provides the host's current invoice/product records; onChanged refreshes it after successful invoice or stock actions. */
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
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const products = useMemo(() => [...state.products].sort((a, b) => a.name.localeCompare(b.name)), [state.products]);
  const intakeWithDrafts = useMemo(() => intakes.map((intake) => ({
    ...intake,
    proposals: [...intake.proposals, ...(manualLines[intake.id] ?? [])]
      .map((proposal) => ({ ...proposal, draft: drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal) })),
  })), [intakes, drafts, manualLines]);

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const result = await request<OperationsResponse>("/api/operations");
      setSupplierList(result.suppliers ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load supplier records.");
    } finally { setLoadingSuppliers(false); }
  }, []);
  useEffect(() => { void loadSuppliers(); }, [loadSuppliers]);

  function patchDraft(intakeId: string, proposal: ProductionProposal, patch: Partial<ProposalDraft>) {
    const key = `${intakeId}:${proposal.id}`;
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? initialDraft(proposal)), ...patch } }));
    setError("");
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
    if (!uploadRetry.current || uploadRetry.current.key !== retryKey) uploadRetry.current = { key: retryKey, requestId: crypto.randomUUID() };
    const body = new FormData();
    body.append("file", file);
    body.append("requestId", uploadRetry.current.requestId);
    setUploading(true);
    try {
      const result = await request<StateResponse>("/api/invoices", { method: "POST", body });
      uploadRetry.current = null;
      const uploadedIntakes = result.state.invoiceIntakes as ProductionIntake[];
      const uploaded = uploadedIntakes.filter((intake) => intake.fileName === file.name).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
      if (uploaded?.processingStatus === "failed") {
        setSuccess("Invoice file uploaded and retained, but extraction failed. No stock has changed; retry processing or add lines manually.");
        setUploadError(uploaded.processingError || "Processing failed. The uploaded document remains available for review.");
      } else if (uploaded?.processingStatus === "processing") {
        setSuccess("Invoice uploaded and processing has started. No stock has changed.");
      } else {
        setSuccess("Invoice uploaded to review. No stock has changed.");
      }
      await applyStateResponse();
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Invoice upload failed. Retry with the same file to reuse its request reference.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function proposalInput(draft: ProposalDraft): InvoiceProposalInput {
    return {
      productName: clean(draft.productName), sku: clean(draft.sku), category: clean(draft.category),
      quantity: draft.quantity.trim() ? Number(draft.quantity) : null,
      unit: clean(draft.unit), batchId: clean(draft.batchId), expiryDate: clean(draft.expiryDate),
      ...(draft.matchMode === "existing" && draft.matchedProductId ? { matchedProductId: draft.matchedProductId } : {}),
    };
  }
  function validateProposal(draft: ProposalDraft, forReceiving: boolean) {
    const fields = proposalInput(draft);
    if (draft.quantity.trim() && (!Number.isFinite(fields.quantity) || Number(fields.quantity) <= 0)) throw new Error("Invoiced quantity must be a positive number.");
    decimalToMinor(draft.unitPrice);
    decimalToMinor(draft.tax);
    if (!forReceiving) return fields;
    if (!draft.matchMode) throw new Error("Choose an existing product or a new product.");
    if (!fields.productName || !fields.sku || !fields.unit) throw new Error("Product name, SKU, and unit must be verified before receiving.");
    if (draft.matchMode === "existing" && (!draft.matchedProductId || !products.some((product) => product.id === draft.matchedProductId))) {
      throw new Error("Choose a verified existing product.");
    }
    if (draft.matchMode === "new" && !fields.category) throw new Error("A category is required for a new product.");
    if (!fields.batchId) throw new Error("A real batch ID is required; it is never generated automatically.");
    if (forReceiving && !draft.expiryNotApplicable && (!fields.expiryDate || Number.isNaN(new Date(`${fields.expiryDate}T00:00:00`).getTime()))) {
      throw new Error("Enter a verified expiry date or explicitly mark expiry as not applicable.");
    }
    return fields;
  }

  async function saveReview(intake: ProductionIntake) {
    const header = currentHeader(intake);
    setBusy(`save-${intake.id}`); setError(""); setSuccess("");
    try {
      const amounts = headerAmounts[intake.id];
      const taxMinor = amounts ? decimalToMinor(amounts.tax) : header.taxMinor;
      const totalMinor = amounts ? decimalToMinor(amounts.total) : header.totalMinor;
      const lines = intake.proposals.filter((proposal) => proposal.status === "pending").map((proposal) => {
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "update_invoice", payload: { intakeId: intake.id, reason: "Invoice details reviewed", header: { ...header, taxMinor, totalMinor }, lines } }),
      });
      setSuccess("Review edits saved. No stock was received.");
      setDrafts((current) => {
        const next = { ...current };
        intake.proposals.forEach((proposal) => { delete next[`${intake.id}:${proposal.id}`]; });
        return next;
      });
      setManualLines((current) => { const next = { ...current }; delete next[intake.id]; return next; });
      setHeaderDrafts((current) => { const next = { ...current }; delete next[intake.id]; return next; });
      setHeaderAmounts((current) => { const next = { ...current }; delete next[intake.id]; return next; });
      await applyStateResponse();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save invoice review."); }
    finally { setBusy(""); }
  }

  async function receive(intake: ProductionIntake) {
    setError(""); setSuccess("");
    const pending = intake.proposals.filter((proposal) => {
      const draft = drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal);
      return !proposal.id.startsWith("manual-") && (proposal.status === "pending" || proposal.status === "confirmed") && draft.receiveSelected && (proposal.quantity ?? 0) > receivedTotal(intake, proposal);
    });
    if (!pending.length) { setError("Select at least one unreceived line to receive."); return; }
    if (!window.confirm(`Receive the selected physical quantities for ${intake.fileName}? This will update stock and create a receipt record.`)) return;
    setBusy(`receive-${intake.id}`);
    try {
      const lines = pending.map((proposal) => {
        const draft = drafts[`${intake.id}:${proposal.id}`] ?? initialDraft(proposal);
        const fields = validateProposal(draft, true);
        const remaining = (proposal.quantity ?? 0) - receivedTotal(intake, proposal);
        const quantity = Number(drafts[`${intake.id}:${proposal.id}`]?.receiveQuantity ?? remaining);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) throw new Error(`${proposal.productName || "Line"}: physical quantity must be positive and no greater than the remaining invoiced quantity (${remaining}).`);
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "receive_invoice", payload: { intakeId: intake.id, requestId, confirmed: true, ...(clean(discrepancyReasons[intake.id] ?? "") ? { discrepancyReason: clean(discrepancyReasons[intake.id]) } : {}), lines } }),
      });
      delete receiptRetryIds.current[intake.id];
      setSuccess("Receipt recorded. Stock now reflects the confirmed physical quantities.");
      setDrafts((current) => {
        const next = { ...current };
        pending.forEach((proposal) => { delete next[`${intake.id}:${proposal.id}`]; });
        return next;
      });
      await applyStateResponse();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not receive these invoice lines."); }
    finally { setBusy(""); }
  }

  async function discardLine(intake: ProductionIntake, proposal: ProductionProposal) {
    const reason = window.prompt(`Why should invoice line "${proposal.productName || proposal.id}" be discarded?`);
    if (reason === null) return;
    if (!clean(reason)) {
      setError("A reason is required to discard an invoice line.");
      return;
    }
    if (!window.confirm(`Discard "${proposal.productName || proposal.id}" from this invoice? This will be recorded in correction history.`)) return;
    const busyKey = `discard-${intake.id}-${proposal.id}`;
    setBusy(busyKey);
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
      setSuccess(`Invoice line "${proposal.productName || proposal.id}" was discarded and recorded.`);
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

  function receivedTotal(intake: ProductionIntake, proposal: ProductionProposal) {
    const fromReceipts = (intake.receipts ?? []).reduce((sum, receipt) => sum + receipt.lines.reduce((lineSum, line) => lineSum + (line.proposalId === proposal.id ? line.quantity : 0), 0), 0);
    return fromReceipts || proposal.receivedQuantity || 0;
  }
  async function retryProcessing(intake: ProductionIntake) {
    setBusy(`retry-${intake.id}`); setError(""); setSuccess("");
    try {
      await request<StateResponse>("/api/receiving", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "retry_processing", payload: { intakeId: intake.id } }) });
      setSuccess("Invoice processing restarted."); await applyStateResponse();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not retry invoice processing."); }
    finally { setBusy(""); }
  }
  async function cancelInvoice(intake: ProductionIntake) {
    const reason = window.prompt("Why is this invoice being cancelled?");
    if (reason === null) return;
    if (!clean(reason)) { setError("A cancellation reason is required."); return; }
    if (!window.confirm(`Cancel ${intake.fileName}? Any existing receipt history will remain visible.`)) return;
    setBusy(`cancel-${intake.id}`); setError(""); setSuccess("");
    try {
      await request<StateResponse>("/api/receiving", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "cancel_invoice", payload: { intakeId: intake.id, reason: clean(reason) } }) });
      setSuccess("Invoice cancelled."); await applyStateResponse();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not cancel this invoice."); }
    finally { setBusy(""); }
  }
  async function addSupplier(event: FormEvent) {
    event.preventDefault(); setSavingSupplier(true); setError(""); setSuccess("");
    try {
      const result = await request<OperationsResponse>("/api/operations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save_supplier", payload: { name: clean(supplierName), ...(clean(supplierReference) ? { reference: clean(supplierReference) } : {}) } }),
      });
      setSupplierList(result.suppliers ?? []);
      setSupplierName(""); setSupplierReference(""); setSuccess("Supplier saved."); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save supplier."); }
    finally { setSavingSupplier(false); }
  }

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <header className={styles.head}>
      <div><h2 className={styles.title} id={`${id}-title`}>Invoice receiving</h2><p className={styles.subtitle}>Review verified details first. Uploading and saving review edits never changes stock.</p></div>
      <span className={styles.badge}>{intakes.length} {intakes.length === 1 ? "invoice" : "invoices"}</span>
    </header>
    <div className={styles.body}>
      <div className={styles.inline}>
        <div><strong className={styles.recordTitle}>Upload invoice</strong><p className={styles.muted}>PDF, CSV, PNG, or JPEG. Upload creates an intake for review only.</p></div>
        <input ref={fileRef} type="file" accept=".pdf,.csv,.png,.jpg,.jpeg,application/pdf,text/csv,image/png,image/jpeg" hidden onChange={(event) => void upload(event.target.files?.[0])} aria-label="Choose invoice file" />
        <button className={`${styles.button} ${styles.primary}`} type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle size={14} aria-hidden="true" /> : <FileUp size={14} aria-hidden="true" />}{uploading ? "Uploading…" : "Choose invoice"}</button>
      </div>
      <form onSubmit={(event) => void addSupplier(event)} style={{ marginTop: 16 }}>
        <h3 className={styles.subhead}>Supplier records</h3>
        <div className={styles.inline}><div className={styles.field} style={{ flex: "1 1 180px" }}><label htmlFor={`${id}-supplier`}>Supplier name</label><input id={`${id}-supplier`} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required /></div><div className={styles.field} style={{ flex: "1 1 150px" }}><label htmlFor={`${id}-reference`}>Reference <span className={styles.muted}>(optional)</span></label><input id={`${id}-reference`} value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} /></div><button className={styles.button} type="submit" disabled={savingSupplier || !supplierName.trim()}>{savingSupplier ? "Saving…" : "Save supplier"}</button></div>
        {loadingSuppliers ? <p className={styles.muted}>Loading saved suppliers…</p> : supplierList.length ? <p className={styles.muted} style={{ marginTop: 6 }}>{supplierList.length} supplier record(s) available for invoice matching.</p> : <p className={styles.muted}>No supplier records yet.</p>}
      </form>
      {uploadError && <div className={styles.feedback} role="alert">{uploadError} The same file can be retried without creating a second upload.</div>}
      {error && <div className={styles.feedback} role="alert">{error}</div>}
      {success && <div className={`${styles.feedback} ${styles.success}`} role="status">{success}</div>}
    </div>
    {intakeWithDrafts.length ? <div className={styles.body} style={{ paddingTop: 0 }}>
      <div className={styles.stack}>
        {intakeWithDrafts.map((intake) => {
          const header = currentHeader(intake);
          const status = intake.processingStatus ?? "review";
          const hasPendingReview = intake.proposals.some((proposal) => proposal.status === "pending");
          const hasReceivable = intake.proposals.some((proposal) =>
            (proposal.status === "pending" || proposal.status === "confirmed")
            && (proposal.quantity ?? 0) > receivedTotal(intake, proposal));
          return <article className={styles.record} key={intake.id}>
            <div className={styles.recordHead}>
              <div className={styles.inline}><FileText size={17} aria-hidden="true" /><div><h3 className={styles.recordTitle}>{intake.fileName}</h3><p className={styles.muted}>{dateLabel(intake.uploadedAt)} · {intake.proposals.length} extracted lines</p></div></div>
              <span className={styles.badge}>{status}</span>
            </div>
            <div className={styles.actions}>
              <a className={styles.fileLink} href={`/api/invoices/${encodeURIComponent(intake.id)}/file`}>Open original file</a>
              {status !== "cancelled" && <button type="button" className={styles.button} disabled={status === "processing"} onClick={() => addManualLine(intake)}><Plus size={13} aria-hidden="true" />Add line</button>}
              {status === "failed" && <button type="button" className={styles.button} disabled={!!busy} onClick={() => void retryProcessing(intake)}><RefreshCw size={13} aria-hidden="true" />Retry processing</button>}
              {status !== "cancelled" && <button type="button" className={`${styles.button} ${styles.danger}`} disabled={!!busy} onClick={() => void cancelInvoice(intake)}><X size={13} aria-hidden="true" />Cancel invoice</button>}
            </div>
            {intake.processingError && <div className={styles.feedback} role="alert">{intake.processingError}</div>}
            {intake.warnings.map((warning, index) => <div className={styles.notice} style={{ marginTop: 8 }} key={`${index}-${warning}`}><AlertTriangle size={14} aria-hidden="true" /> {warning}</div>)}
            <div className={styles.grid} style={{ marginTop: 14 }}>
              <div className={styles.field}><label htmlFor={`${id}-${intake.id}-supplier`}>Supplier match</label><select id={`${id}-${intake.id}-supplier`} value={header.supplierId ?? ""} onChange={(event) => updateHeader(intake.id, { supplierId: event.target.value || undefined, supplierName: supplierList.find((supplier) => supplier.id === event.target.value)?.name }, intake)}><option value="">No verified supplier selected</option>{supplierList.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}{supplier.reference ? ` · ${supplier.reference}` : ""}</option>)}</select></div>
              <div className={styles.field}><label htmlFor={`${id}-${intake.id}-number`}>Invoice number</label><input id={`${id}-${intake.id}-number`} value={header.invoiceNumber ?? ""} onChange={(event) => updateHeader(intake.id, { invoiceNumber: event.target.value }, intake)} /></div>
              <div className={styles.field}><label htmlFor={`${id}-${intake.id}-date`}>Invoice date</label><input id={`${id}-${intake.id}-date`} type="date" value={header.invoiceDate ?? ""} onChange={(event) => updateHeader(intake.id, { invoiceDate: event.target.value }, intake)} /></div>
              <div className={styles.field}><label htmlFor={`${id}-${intake.id}-tax`}>Invoice tax amount</label><input id={`${id}-${intake.id}-tax`} inputMode="decimal" placeholder="Amount in currency" value={headerAmounts[intake.id]?.tax ?? minorToDecimal(header.taxMinor)} onChange={(event) => { setHeaderAmounts((current) => ({ ...current, [intake.id]: { tax: event.target.value, total: current[intake.id]?.total ?? minorToDecimal(header.totalMinor) } })); setError(""); }} /></div>
              <div className={styles.field}><label htmlFor={`${id}-${intake.id}-total`}>Invoice total amount</label><input id={`${id}-${intake.id}-total`} inputMode="decimal" placeholder="Amount in currency" value={headerAmounts[intake.id]?.total ?? minorToDecimal(header.totalMinor)} onChange={(event) => { setHeaderAmounts((current) => ({ ...current, [intake.id]: { tax: current[intake.id]?.tax ?? minorToDecimal(header.taxMinor), total: event.target.value } })); setError(""); }} /></div>
            </div>
            {intake.proposals.length === 0 ? <div className={styles.empty}><PackageCheck size={20} aria-hidden="true" /><div>No invoice lines were extracted.</div></div> : intake.proposals.map((proposal) => {
              const draft = proposal.draft;
              const isReviewable = proposal.status === "pending";
              const received = receivedTotal(intake, proposal);
              const remaining = Math.max(0, (proposal.quantity ?? 0) - received);
              const matched = products.find((product) => product.id === draft.matchedProductId);
              const receiveQuantity = drafts[`${intake.id}:${proposal.id}`]?.receiveQuantity || String(remaining);
              const lineHasReceipts = received > 0 || (proposal.receivedQuantity ?? 0) > 0;
              const discardDisabled = !!busy || proposal.status !== "pending" || lineHasReceipts
                || status === "cancelled" || status === "processing" || proposal.id.startsWith("manual-");
              return <div className={styles.lineCard} key={proposal.id}>
                <div className={styles.lineHead}><div><strong className={styles.recordTitle}>{proposal.productName || "Unidentified invoice line"}</strong><div className={styles.muted}>{proposal.sku ? `SKU ${proposal.sku}` : "SKU not found"} · {proposal.category || "Category not found"}</div></div><span className={styles.badge}>{proposal.status}</span></div>
                {proposal.issues.length > 0 && <div className={styles.notice}><AlertTriangle size={14} aria-hidden="true" /> Needs verification: {proposal.issues.join("; ")}</div>}
                <div className={styles.infoRows}>
                  <div className={styles.infoCell}><div className={styles.infoLabel}>Invoiced quantity</div><div className={styles.infoValue}>{proposal.quantity ?? "Not found"} {proposal.unit}</div></div>
                  <div className={styles.infoCell}><div className={styles.infoLabel}>Received to date</div><div className={styles.infoValue}>{received} {proposal.unit}</div></div>
                  <div className={styles.infoCell}><div className={styles.infoLabel}>Remaining invoiced</div><div className={styles.infoValue}>{proposal.quantity === null ? "Unknown" : `${remaining} ${proposal.unit}`}</div></div>
                </div>
                {isReviewable ? <div className={styles.stack} style={{ marginTop: 12 }}>
                  <div className={styles.grid}>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-mode`}>Product destination</label><select id={`${id}-${proposal.id}-mode`} value={draft.matchMode} onChange={(event) => patchDraft(intake.id, proposal, { matchMode: event.target.value as "existing" | "new", matchedProductId: event.target.value === "new" ? "" : draft.matchedProductId })}><option value="existing">Match existing product</option><option value="new">New product</option></select></div>
                    {draft.matchMode === "existing" && <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-product`}>Verified product</label><select id={`${id}-${proposal.id}-product`} value={draft.matchedProductId} onChange={(event) => {
                      const product = products.find((item) => item.id === event.target.value);
                      patchDraft(intake.id, proposal, { matchedProductId: event.target.value, ...(product ? { productName: product.name, sku: product.sku, category: product.category, unit: product.unit } : {}) });
                    }}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · {product.unit}</option>)}</select></div>}
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-name`}>Product name</label><input id={`${id}-${proposal.id}-name`} value={draft.productName} onChange={(event) => patchDraft(intake.id, proposal, { productName: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-sku`}>SKU</label><input id={`${id}-${proposal.id}-sku`} value={draft.sku} onChange={(event) => patchDraft(intake.id, proposal, { sku: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-category`}>Category {draft.matchMode === "new" && "(required)"}</label><input id={`${id}-${proposal.id}-category`} value={draft.category} onChange={(event) => patchDraft(intake.id, proposal, { category: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-unit`}>Unit</label><input id={`${id}-${proposal.id}-unit`} value={draft.unit} onChange={(event) => patchDraft(intake.id, proposal, { unit: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-invqty`}>Invoiced quantity</label><input id={`${id}-${proposal.id}-invqty`} type="number" min="0" step="any" value={draft.quantity} onChange={(event) => patchDraft(intake.id, proposal, { quantity: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-batch`}>Batch ID</label><input id={`${id}-${proposal.id}-batch`} value={draft.batchId} onChange={(event) => patchDraft(intake.id, proposal, { batchId: event.target.value })} placeholder="Enter verified batch ID" /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-expiry`}>Expiry date</label><input id={`${id}-${proposal.id}-expiry`} type="date" value={draft.expiryDate} disabled={draft.expiryNotApplicable} onChange={(event) => patchDraft(intake.id, proposal, { expiryDate: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-price`}>Unit price <span className={styles.muted}>(optional)</span></label><input id={`${id}-${proposal.id}-price`} inputMode="decimal" value={draft.unitPrice} onChange={(event) => patchDraft(intake.id, proposal, { unitPrice: event.target.value })} placeholder="0.00" /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-linetax`}>Line tax <span className={styles.muted}>(optional)</span></label><input id={`${id}-${proposal.id}-linetax`} inputMode="decimal" value={draft.tax} onChange={(event) => patchDraft(intake.id, proposal, { tax: event.target.value })} placeholder="0.00" /></div>
                  </div>
                  <p className={styles.muted}>No missing SKU, category, unit, batch, expiry, or price is filled with invented data. A verified existing product fills its catalog fields only.</p>
                  {draft.matchMode === "existing" && matched && <p className={styles.muted}>Matched catalog record: {matched.name} · {matched.sku} · {matched.category} · {matched.unit}</p>}
                  <label className={styles.checkbox}><input type="checkbox" checked={draft.expiryNotApplicable} onChange={(event) => patchDraft(intake.id, proposal, { expiryNotApplicable: event.target.checked })} />Expiry is not applicable to this received batch</label>
                  <label className={styles.checkbox}><input type="checkbox" checked={draft.receiveSelected} disabled={remaining <= 0} onChange={(event) => patchDraft(intake.id, proposal, { receiveSelected: event.target.checked })} />Include this line in the next physical receipt</label>
                  <div className={styles.grid}>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-receivedqty`}>Physical quantity received now</label><input id={`${id}-${proposal.id}-receivedqty`} type="number" min="0" max={remaining} step="any" value={receiveQuantity} onChange={(event) => patchDraft(intake.id, proposal, { receiveQuantity: event.target.value })} /></div>
                    <p className={styles.notice}>A partial delivery is allowed. Remaining quantity is calculated from receipt history; batch and expiry are required before stock is posted.</p>
                  </div>
                </div> : proposal.status === "confirmed" && remaining > 0 ? <div className={styles.stack} style={{ marginTop: 12 }}>
                  <p className={styles.muted}>Verified product destination: {draft.productName} · {draft.sku} · {draft.unit}. Additional partial receipts remain available.</p>
                  <label className={styles.checkbox}><input type="checkbox" checked={draft.receiveSelected} onChange={(event) => patchDraft(intake.id, proposal, { receiveSelected: event.target.checked })} />Include this line in the next physical receipt</label>
                  <div className={styles.grid}>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-moreqty`}>Physical quantity received now</label><input id={`${id}-${proposal.id}-moreqty`} type="number" min="0" max={remaining} step="any" value={receiveQuantity} onChange={(event) => patchDraft(intake.id, proposal, { receiveQuantity: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-morebatch`}>Physical batch ID</label><input id={`${id}-${proposal.id}-morebatch`} value={draft.batchId} onChange={(event) => patchDraft(intake.id, proposal, { batchId: event.target.value })} /></div>
                    <div className={styles.field}><label htmlFor={`${id}-${proposal.id}-moreexpiry`}>Expiry date</label><input id={`${id}-${proposal.id}-moreexpiry`} type="date" value={draft.expiryDate} disabled={draft.expiryNotApplicable} onChange={(event) => patchDraft(intake.id, proposal, { expiryDate: event.target.value })} /></div>
                    <p className={styles.notice}>Remaining invoiced quantity: {remaining} {proposal.unit}. Batch ID and expiry must be verified for each receipt.</p>
                  </div>
                  <label className={styles.checkbox}><input type="checkbox" checked={draft.expiryNotApplicable} onChange={(event) => patchDraft(intake.id, proposal, { expiryNotApplicable: event.target.checked })} />Expiry is not applicable to this received batch</label>
                </div> : <p className={styles.muted} style={{ marginTop: 10 }}>{proposal.status === "confirmed" ? "The invoiced quantity has been fully received." : "This proposal is not available for review."}</p>}
                {(intake.receipts ?? []).filter((receipt) => receipt.lines.some((line) => line.proposalId === proposal.id)).length > 0 && <div className={styles.history}><strong className={styles.small}>Receipt history</strong>{(intake.receipts ?? []).map((receipt) => {
                  const line = receipt.lines.find((entry) => entry.proposalId === proposal.id);
                  return line ? <div className={styles.historyItem} key={receipt.id}>Received {line.quantity} {proposal.unit} · batch {line.batchId} · expires {line.expiryDate} · {dateLabel(receipt.receivedAt)}{receipt.discrepancyReason ? ` · ${receipt.discrepancyReason}` : ""}</div> : null;
                })}</div>}
                <div className={styles.actions}>
                  <button type="button" className={`${styles.button} ${styles.danger}`} disabled={discardDisabled} onClick={() => void discardLine(intake, proposal)}>
                    {busy === `discard-${intake.id}-${proposal.id}` ? <LoaderCircle size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                    Discard line
                  </button>
                  {lineHasReceipts && <span className={styles.muted}>This line has posted receipts. Reverse the receipt before changing or discarding it.</span>}
                  {proposal.id.startsWith("manual-") && <span className={styles.muted}>Save this manually added line before discarding it.</span>}
                  {status === "cancelled" && <span className={styles.muted}>Cancelled invoices cannot be changed.</span>}
                  {status === "processing" && <span className={styles.muted}>Wait for invoice processing to finish before changing lines.</span>}
                </div>
              </div>;
            })}
            {(intake.corrections ?? []).length > 0 && <><h4 className={styles.subhead}>Correction history</h4><div className={styles.history}>{intake.corrections?.map((correction, index) => <div className={styles.historyItem} key={`${correction.at}-${index}`}><strong>{dateLabel(correction.at)}</strong> · {correction.reason}<div className={styles.muted}>Recorded by {correction.actorId}. Previous values: {JSON.stringify(correction.before)}</div></div>)}</div></>}
            {(hasPendingReview || hasReceivable) && status !== "processing" && status !== "cancelled" && <div className={styles.actions}>
              {hasPendingReview && <button type="button" className={styles.button} disabled={!!busy} onClick={() => void saveReview(intake)}>{busy === `save-${intake.id}` ? <LoaderCircle size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}Save review edits</button>}
              {hasReceivable && <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!!busy} onClick={() => void receive(intake)}>{busy === `receive-${intake.id}` ? <LoaderCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}Confirm physical receipt</button>}
            </div>}
            {(intake.proposals.some((proposal) => proposal.status === "pending" || proposal.status === "confirmed") && status !== "processing" && status !== "cancelled") && <div className={styles.field} style={{ marginTop: 12 }}><label htmlFor={`${id}-${intake.id}-discrepancy`}>Delivery discrepancy note <span className={styles.muted}>(optional)</span></label><textarea id={`${id}-${intake.id}-discrepancy`} value={discrepancyReasons[intake.id] ?? ""} onChange={(event) => setDiscrepancyReasons((current) => ({ ...current, [intake.id]: event.target.value }))} placeholder="Explain a short delivery or quantity mismatch, if applicable." /></div>}
          </article>;
        })}
      </div>
    </div> : <div className={styles.empty}><PackageCheck size={22} aria-hidden="true" /><p>No invoice intakes yet. Upload a supplier invoice to begin review.</p></div>}
  </section>;
}

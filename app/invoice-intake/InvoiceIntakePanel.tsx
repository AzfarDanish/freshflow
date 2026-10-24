"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle, Check, CheckCircle2, CircleHelp, FileText, FileUp,
  LoaderCircle, PackageCheck, ReceiptText, Save, X,
} from "lucide-react";
import type { Product } from "@/src/lib/types";
import styles from "./InvoiceIntakePanel.module.css";

type Role = "owner" | "staff";
type ProposalStatus = "pending" | "confirmed" | "discarded";

type Proposal = {
  id: string;
  productName: string;
  sku: string;
  category: string;
  quantity: number | null;
  unit: string;
  batchId: string;
  expiryDate: string;
  status: ProposalStatus;
  issues: string[];
  matchedProductId?: string;
};

type Intake = {
  id: string;
  fileName: string;
  uploadedAt: string;
  status: "review" | "completed";
  warnings: string[];
  proposals: Proposal[];
};

type ProposalFields = {
  productName: string;
  sku: string;
  category: string;
  quantity: number | null;
  unit: string;
  batchId: string;
  expiryDate: string;
  matchedProductId: string | null;
};

type ConfirmFields = ProposalFields & { matchMode: "existing" | "new" };

export type InvoiceIntakePanelProps = {
  businessId: string;
  businessName: string;
  role: Role;
  products: Product[];
  intakes: Intake[];
  busy: boolean;
  onUpload(file: File): Promise<void>;
  onSaveProposal(intakeId: string, proposalId: string, fields: ProposalFields): Promise<void>;
  onConfirmProposal(intakeId: string, proposalId: string, fields: ConfirmFields): Promise<void>;
  onDiscardProposal(intakeId: string, proposalId: string): Promise<void>;
};

type Draft = {
  productName: string;
  sku: string;
  category: string;
  quantity: string;
  unit: string;
  batchId: string;
  expiryDate: string;
  matchMode: "existing" | "new" | "";
  matchedProductId: string;
};

function toDraft(proposal: Proposal): Draft {
  return {
    productName: proposal.productName ?? "",
    sku: proposal.sku ?? "",
    category: proposal.category ?? "",
    quantity: proposal.quantity === null ? "" : String(proposal.quantity),
    unit: proposal.unit ?? "",
    batchId: proposal.batchId ?? "",
    expiryDate: proposal.expiryDate ?? "",
    matchMode: proposal.matchedProductId ? "existing" : "",
    matchedProductId: proposal.matchedProductId ?? "",
  };
}

function formatDate(value: string): string {
  if (!value) return "Not found";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function formatUploaded(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "Upload time unavailable";
  return parsed.toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") return "Not found";
  return String(value);
}

function dataClass(value: string | number | null | undefined) {
  return value === null || value === undefined || String(value).trim() === "" ? styles.missing : styles.dataValue;
}

export function InvoiceIntakePanel({
  businessId,
  businessName,
  role,
  products,
  intakes,
  busy,
  onUpload,
  onSaveProposal,
  onConfirmProposal,
  onDiscardProposal,
}: InvoiceIntakePanelProps) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState("");

  const productOptions = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const canEdit = role === "owner";

  function getDraft(intakeId: string, proposal: Proposal) {
    const key = `${intakeId}:${proposal.id}`;
    return drafts[key] ?? toDraft(proposal);
  }

  function patchDraft(intakeId: string, proposal: Proposal, patch: Partial<Draft>) {
    const key = `${intakeId}:${proposal.id}`;
    setDrafts((current) => ({ ...current, [key]: { ...getDraft(intakeId, proposal), ...patch } }));
    setValidation((current) => ({ ...current, [key]: "" }));
  }

  function fieldsFromDraft(draft: Draft): ProposalFields | null {
    const quantity = draft.quantity.trim() === "" ? null : Number(draft.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000)) return null;
    return {
      productName: draft.productName.trim(),
      sku: draft.sku.trim(),
      category: draft.category.trim(),
      quantity,
      unit: draft.unit.trim(),
      batchId: draft.batchId.trim(),
      expiryDate: draft.expiryDate.trim(),
      matchedProductId: draft.matchMode === "existing" && draft.matchedProductId ? draft.matchedProductId : null,
    };
  }

  function validate(draft: Draft, proposalKey: string, isConfirm: boolean): ProposalFields | null {
    const fields = fieldsFromDraft(draft);
    const missing: string[] = [];
    if (!fields) missing.push("Quantity must be a positive number.");
    if (isConfirm) {
      if (!draft.matchMode) missing.push("Choose Match existing product or Create new product.");
      if (!draft.productName.trim()) missing.push("Add a product name.");
      if (!draft.sku.trim()) missing.push("Add a SKU.");
      if (draft.matchMode === "new" && !draft.category.trim()) missing.push("Add a category for the new product.");
      if (!draft.unit.trim()) missing.push("Add a unit.");
      if (!draft.batchId.trim()) missing.push("Add a batch ID.");
      if (!draft.expiryDate.trim()) missing.push("Add an expiry date.");
      if (draft.matchMode === "existing" && !draft.matchedProductId) missing.push("Choose the existing product to match.");
    }
    if (missing.length) {
      setValidation((current) => ({ ...current, [proposalKey]: missing.join(" ") }));
      return null;
    }
    setValidation((current) => ({ ...current, [proposalKey]: "" }));
    return fields;
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setFeedback("");
    setLocalBusy("upload");
    try {
      await onUpload(file);
      setFeedback(`${file.name} sent for invoice review.`);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload could not be completed.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setLocalBusy(null);
    }
  }

  async function saveProposal(intakeId: string, proposal: Proposal) {
    const key = `${intakeId}:${proposal.id}`;
    const draft = getDraft(intakeId, proposal);
    const fields = validate(draft, key, false);
    if (!fields) return;
    setLocalBusy(key);
    setFeedback("");
    try {
      await onSaveProposal(intakeId, proposal.id, fields);
      setFeedback("Review edits saved. The proposal is still unverified.");
    } catch (error) {
      setValidation((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Could not save these edits." }));
    } finally {
      setLocalBusy(null);
    }
  }

  async function confirmProposal(intakeId: string, proposal: Proposal) {
    const key = `${intakeId}:${proposal.id}`;
    const draft = getDraft(intakeId, proposal);
    const fields = validate(draft, key, true);
    if (!fields) return;
    if (draft.matchMode !== "existing" && draft.matchMode !== "new") return;
    setLocalBusy(key);
    setFeedback("");
    try {
      await onConfirmProposal(intakeId, proposal.id, {
        ...fields,
        matchMode: draft.matchMode,
        matchedProductId: draft.matchMode === "existing" ? draft.matchedProductId : null,
      });
      setFeedback("Proposal confirmed by owner. Inventory changes are handled by the dashboard.");
    } catch (error) {
      setValidation((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Could not confirm this proposal." }));
    } finally {
      setLocalBusy(null);
    }
  }

  async function discardProposal(intakeId: string, proposal: Proposal) {
    const key = `${intakeId}:${proposal.id}`;
    setLocalBusy(key);
    setFeedback("");
    try {
      await onDiscardProposal(intakeId, proposal.id);
      setFeedback("Proposal discarded.");
    } catch (error) {
      setValidation((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Could not discard this proposal." }));
    } finally {
      setLocalBusy(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${inputId}-title`}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <div className={styles.titleLine}>
              <ReceiptText aria-hidden="true" />
              <h2 className={styles.title} id={`${inputId}-title`}>Invoice intake</h2>
            </div>
            <p className={styles.subtitle}>Upload a supplier invoice for review · {businessName}</p>
          </div>
          <span className={styles.headerCount}>{intakes.length} {intakes.length === 1 ? "file" : "files"}</span>
        </header>

        <div className={styles.uploadArea}>
          <span className={styles.uploadIcon}><FileUp aria-hidden="true" /></span>
          <div className={styles.uploadCopy}>
            <div className={styles.uploadTitle}>Bring in a supplier invoice</div>
          <div className={styles.uploadHint}>PDF or CSV · Text-based PDFs only; scanned image PDFs are not supported.</div>
          </div>
          <input
            ref={fileInput}
            className={styles.fileInput}
            id={inputId}
            type="file"
            accept=".pdf,.csv,application/pdf,text/csv"
            disabled={busy || localBusy !== null}
            onChange={(event) => void handleUpload(event)}
            aria-label="Choose an invoice PDF or CSV file"
          />
          <label className={styles.uploadButton} htmlFor={inputId} aria-disabled={busy || localBusy !== null}>
            {localBusy === "upload" ? <LoaderCircle aria-hidden="true" /> : <FileUp aria-hidden="true" />}
            {localBusy === "upload" ? "Uploading…" : "Choose invoice"}
          </label>
        </div>
        {uploadError && <div className={styles.validation} role="alert" style={{ margin: "8px 17px 0" }}><AlertTriangle />{uploadError}</div>}
        <div className={styles.notice}>
          <CircleHelp aria-hidden="true" />
          <span><strong>No stock changes happen on upload.</strong> Extracted values may be incomplete or ambiguous; only an owner can verify each line and confirm a stock change.</span>
        </div>

        {feedback && <div className={styles.toast} role="status"><CheckCircle2 aria-hidden="true" />{feedback}</div>}
        {busy && <div className={styles.busyNote} style={{ margin: "0 17px 10px" }}><LoaderCircle aria-hidden="true" />Dashboard action in progress…</div>}

        {busy && intakes.length === 0 ? (
          <div className={styles.loading} aria-label="Loading invoice intakes" aria-busy="true">
            <div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} />
          </div>
        ) : intakes.length ? (
          <div className={styles.intakeList}>
            {intakes.map((intake) => (
              <article className={styles.intake} key={intake.id}>
                <div className={styles.intakeHead}>
                  <div className={styles.fileMeta}>
                    <span className={styles.fileIcon}><FileText aria-hidden="true" /></span>
                    <div className={styles.fileDetails}>
                      <div className={styles.fileName} title={intake.fileName}>{intake.fileName}</div>
                      <div className={styles.uploadedAt}>{formatUploaded(intake.uploadedAt)} · {intake.proposals.length} {intake.proposals.length === 1 ? "line" : "lines"}</div>
                    </div>
                  </div>
                  <a className={styles.fileLink} href={`/api/invoices/${encodeURIComponent(intake.id)}/file?businessId=${encodeURIComponent(businessId)}`}>
                    Original
                  </a>
                  <span className={`${styles.status} ${intake.status === "completed" ? styles.statusComplete : ""}`}>
                    {intake.status === "completed" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                    {intake.status === "completed" ? "Reviewed" : "Needs review"}
                  </span>
                </div>
                {intake.warnings.map((warning, index) => (
                  <div className={styles.fileWarning} key={`${warning}-${index}`}><AlertTriangle aria-hidden="true" />{warning}</div>
                ))}
                {intake.proposals.length === 0 ? (
                  <div className={styles.empty}>
                    <div className={styles.emptyIcon}><PackageCheck aria-hidden="true" /></div>
                    <div className={styles.emptyTitle}>No invoice lines found</div>
                    <div className={styles.emptyText}>The file is saved, but no proposals were extracted. Check that the document is readable.</div>
                  </div>
                ) : (
                  <div className={styles.proposalList}>
                    {intake.proposals.map((proposal) => {
                      const key = `${intake.id}:${proposal.id}`;
                      const draft = getDraft(intake.id, proposal);
                      const isPending = proposal.status === "pending";
                      const actionBusy = localBusy === key || busy;
                      return (
                        <article className={styles.proposal} key={proposal.id}>
                          <div className={styles.proposalTop}>
                            <div className={styles.productHeading}>
                              <div className={dataClass(proposal.productName)}>{display(proposal.productName)}</div>
                              <div className={styles.productSku}>{proposal.sku ? `SKU ${proposal.sku}` : "SKU not found"} · {proposal.category || "Category not found"}</div>
                            </div>
                            <span className={styles.unverified}>{proposal.status === "confirmed" ? "Owner confirmed" : proposal.status === "discarded" ? "Discarded" : "Unverified"}</span>
                          </div>
                          <div className={styles.proposalBody}>
                            <div className={styles.dataGrid}>
                              <div className={styles.dataItem}><div className={styles.dataLabel}>Quantity</div><div className={dataClass(proposal.quantity)}>{display(proposal.quantity)} {proposal.quantity !== null && proposal.unit ? proposal.unit : ""}</div></div>
                              <div className={styles.dataItem}><div className={styles.dataLabel}>Unit</div><div className={dataClass(proposal.unit)}>{display(proposal.unit)}</div></div>
                              <div className={styles.dataItem}><div className={styles.dataLabel}>Batch ID</div><div className={dataClass(proposal.batchId)}>{display(proposal.batchId)}</div></div>
                              <div className={styles.dataItem}><div className={styles.dataLabel}>Expiry date</div><div className={dataClass(proposal.expiryDate)}>{proposal.expiryDate ? formatDate(proposal.expiryDate) : "Not found"}</div></div>
                            </div>
                            {proposal.issues.length > 0 && (
                              <div className={styles.issueList} aria-label="Extraction issues">
                                <span className={styles.issueLabel}><AlertTriangle aria-hidden="true" />Needs checking</span>
                                {proposal.issues.map((issue, index) => <span className={styles.issue} key={`${issue}-${index}`}>{issue}</span>)}
                              </div>
                            )}
                            {canEdit && isPending ? (
                              <div className={styles.matchArea}>
                                <p className={styles.matchTitle}>Product destination · choose explicitly</p>
                                <div className={styles.matchOptions}>
                                  <label className={styles.radioLabel}>
                                    <input type="radio" name={`match-${inputId}-${key}`} checked={draft.matchMode === "existing"} onChange={() => patchDraft(intake.id, proposal, { matchMode: "existing", matchedProductId: draft.matchedProductId || proposal.matchedProductId || "" })} />
                                    Match existing product
                                  </label>
                                  <label className={styles.radioLabel}>
                                    <input type="radio" name={`match-${inputId}-${key}`} checked={draft.matchMode === "new"} onChange={() => patchDraft(intake.id, proposal, { matchMode: "new", matchedProductId: "" })} />
                                    Create new product
                                  </label>
                                </div>
                                {draft.matchMode === "existing" ? (
                                  <select className={styles.matchSelect} value={draft.matchedProductId} onChange={(event) => {
                                    const matched = productOptions.find((product) => product.id === event.target.value);
                                    patchDraft(intake.id, proposal, {
                                      matchedProductId: event.target.value,
                                      ...(matched ? {
                                        productName: draft.productName || matched.name,
                                        sku: draft.sku || matched.sku,
                                        category: draft.category || matched.category,
                                        unit: draft.unit || matched.unit,
                                      } : {}),
                                    });
                                  }} aria-label={`Choose existing product for ${proposal.productName || "invoice line"}`}>
                                    <option value="">Choose an existing product…</option>
                                    {productOptions.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku} · {product.category}</option>)}
                                  </select>
                                ) : (
                                  <div className={styles.newProductNote}>{draft.matchMode === "new" ? "Confirmation will create a new product and stock batch." : "Choose a product destination above before confirming."} No stock is created before owner confirmation.</div>
                                )}
                                <div className={styles.editGrid}>
                                  <Field label="Product name" value={draft.productName} placeholder="Missing from invoice" invalid={!draft.productName.trim()} onChange={(value) => patchDraft(intake.id, proposal, { productName: value })} />
                                  <Field label="SKU" value={draft.sku} placeholder="Missing from invoice" invalid={!draft.sku.trim()} onChange={(value) => patchDraft(intake.id, proposal, { sku: value })} />
                                  <Field label="Category" value={draft.category} placeholder={draft.matchMode === "existing" ? "Uses the matched product" : "Missing from invoice"} invalid={draft.matchMode === "new" && !draft.category.trim()} onChange={(value) => patchDraft(intake.id, proposal, { category: value })} />
                                  <Field label="Quantity" value={draft.quantity} placeholder="Missing from invoice" invalid={!draft.quantity.trim()} onChange={(value) => patchDraft(intake.id, proposal, { quantity: value })} inputMode="decimal" />
                                  <Field label="Unit" value={draft.unit} placeholder="Missing from invoice" invalid={!draft.unit.trim()} onChange={(value) => patchDraft(intake.id, proposal, { unit: value })} />
                                  <Field label="Batch ID" value={draft.batchId} placeholder="Missing from invoice" invalid={!draft.batchId.trim()} onChange={(value) => patchDraft(intake.id, proposal, { batchId: value })} />
                                  <Field label="Expiry date" value={draft.expiryDate} placeholder="YYYY-MM-DD or not found" invalid={!draft.expiryDate.trim()} inputType="date" onChange={(value) => patchDraft(intake.id, proposal, { expiryDate: value })} />
                                </div>
                                {validation[key] && <div className={styles.validation} role="alert"><AlertTriangle aria-hidden="true" />{validation[key]}</div>}
                                <div className={styles.cardActions}>
                                  <span className={styles.reviewHint}>Save keeps this as a proposal. Confirm is an owner decision.</span>
                                  <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={() => void saveProposal(intake.id, proposal)} disabled={actionBusy}>
                                    <Save aria-hidden="true" />Save edits
                                  </button>
                                  <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void confirmProposal(intake.id, proposal)} disabled={actionBusy}>
                                    {actionBusy ? <LoaderCircle aria-hidden="true" /> : <Check aria-hidden="true" />}Confirm
                                  </button>
                                  <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => void discardProposal(intake.id, proposal)} disabled={actionBusy}>
                                    <X aria-hidden="true" />Discard
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className={styles.readOnly}>
                                {proposal.status === "pending"
                                  ? "Staff view: invoice lines are read-only. An owner must verify and decide whether to match or create a product."
                                  : proposal.status === "confirmed"
                                    ? `Owner confirmed this line as ${proposal.matchedProductId ? "an existing product" : "a new product"}; a batch was added to inventory.`
                                    : "This proposal was discarded; it will not be sent for owner confirmation."}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><ReceiptText aria-hidden="true" /></div>
            <div className={styles.emptyTitle}>No invoices waiting</div>
            <div className={styles.emptyText}>Upload a supplier PDF or CSV. Extracted lines will appear here as unverified proposals for owner review.</div>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  placeholder,
  invalid,
  onChange,
  inputMode,
  inputType,
}: {
  label: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  onChange(value: string): void;
  inputMode?: "decimal";
  inputType?: "date";
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        type={inputType ?? "text"}
        aria-invalid={invalid && value.length > 0}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export default InvoiceIntakePanel;

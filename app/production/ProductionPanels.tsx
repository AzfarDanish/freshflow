"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Database, RefreshCw, RotateCcw, ShieldAlert, Trash2, MessageSquareText } from "lucide-react";
import type { Product } from "@/src/lib/types";
import type { OperationsResponse, StockMovement } from "@/src/lib/operational-types";
import styles from "./ProductionPanels.module.css";

type ApiError = { error?: string; message?: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status}).`);
  return body;
}

function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function daysEarlier(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDate(date);
}
function asMoney(minor: number | null | undefined, currency: string) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "Not recorded";
  return new Intl.NumberFormat("en-MY", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}
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
function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}
/** products supply recorded product/batch choices; onChanged refreshes host inventory after successful stock actions. */
export function InsightsPanel({ products, onChanged, onExplain }: {
  products: Product[];
  onChanged: () => void;
  onExplain: (range: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState(daysEarlier(29));
  const [to, setTo] = useState(localDate());
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"sale" | "waste" | "adjustment">("sale");
  const [productId, setProductId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const retryRequestId = useRef<string | null>(null);
  const reversalRequests = useRef<Record<string, string>>({});
  const assistantRequestId = useId();

  const selectedProduct = products.find((product) => product.id === productId);
  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiJson<OperationsResponse>(`/api/operations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load operations.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    try {
      const amount = Number(quantity);
      if (!Number.isFinite(amount) || amount === 0) throw new Error("Enter a non-zero quantity.");
      if (kind !== "adjustment" && amount <= 0) throw new Error("Sale and waste quantities must be positive.");
      if (!selectedProduct || !batchId) throw new Error("Choose a product and its recorded batch.");
      if (!reason.trim()) throw new Error("Add a reason for this movement.");
      const priceMinor = decimalToMinor(unitPrice);
      const costMinor = decimalToMinor(unitCost);
      if ((kind === "sale" && priceMinor !== undefined && priceMinor < 0) || (kind !== "sale" && priceMinor !== undefined)) {
        throw new Error("Unit price is optional and only applies to a sale.");
      }
      if (costMinor !== undefined && costMinor < 0) throw new Error("Unit cost cannot be negative.");
      const parsedTime = new Date(occurredAt);
      if (Number.isNaN(parsedTime.getTime())) throw new Error("Choose a valid occurrence time.");
      const requestId = retryRequestId.current ?? crypto.randomUUID();
      retryRequestId.current = requestId;
      setBusy("movement");
      await apiJson<OperationsResponse>("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "record_movement", payload: {
          requestId, kind, productId, batchId, quantity: amount,
          ...(priceMinor === undefined ? {} : { unitPriceMinor: priceMinor }),
          ...(costMinor === undefined ? {} : { unitCostMinor: costMinor }),
          reason: reason.trim(), occurredAt: parsedTime.toISOString(),
        } }),
      });
      retryRequestId.current = null;
      setNotice("Movement recorded.");
      setQuantity("");
      setReason("");
      await load();
      onChanged();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Movement could not be recorded.");
    } finally {
      setBusy("");
    }
  }

  async function reverseMovement(movement: StockMovement) {
    const why = window.prompt(`Reason for reversing ${movement.kind} for ${movement.productName}?`);
    if (why === null) return;
    if (!why.trim()) {
      setFormError("A reversal reason is required.");
      return;
    }
    if (!window.confirm(`Reverse this ${movement.kind} record? A reversal record will be added; the original will remain in history.`)) return;
    setBusy(`reverse-${movement.id}`);
    setFormError("");
    setNotice("");
    try {
      const requestId = reversalRequests.current[movement.id] ?? crypto.randomUUID();
      reversalRequests.current[movement.id] = requestId;
      await apiJson<OperationsResponse>("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reverse_movement", payload: { requestId, movementId: movement.id, reason: why.trim() } }),
      });
      delete reversalRequests.current[movement.id];
      setNotice("Reversal recorded.");
      await load();
      onChanged();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Movement could not be reversed.");
    } finally {
      setBusy("");
    }
  }

  const summary = data?.summary;
  const chartRows = summary?.daily ?? [];
  const maxValue = Math.max(1, ...chartRows.flatMap((row) => [row.revenueMinor ?? 0, row.wasteCostMinor ?? 0]));
  const movements = data?.movements ?? [];
  const batches = selectedProduct?.batches ?? [];

  return (
    <section className={styles.panel} aria-labelledby={`${assistantRequestId}-title`}>
      <header className={styles.head}>
        <div><h2 className={styles.title} id={`${assistantRequestId}-title`}>Sales and waste insights</h2><p className={styles.subtitle}>Only recorded movements are included. Unknown prices and costs stay unknown.</p></div>
        <button type="button" className={styles.button} onClick={() => void load()} disabled={loading}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
      </header>
      <div className={styles.body}>
        <div className={styles.filterRow}>
          <div className={styles.field}><label htmlFor={`${assistantRequestId}-from`}>From</label><input id={`${assistantRequestId}-from`} type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className={styles.field}><label htmlFor={`${assistantRequestId}-to`}>To</label><input id={`${assistantRequestId}-to`} type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></div>
        </div>
      </div>
      {error && <div className={styles.feedback} role="alert">{error} <button className={styles.button} type="button" onClick={() => void load()}>Retry</button></div>}
      {loading ? <div className={styles.loading} aria-busy="true" aria-label="Loading insights"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div> : summary && (
        <div className={styles.body}>
          <dl className={styles.statGrid}>
            <div className={styles.stat}><dt className={styles.statLabel}>Sale revenue</dt><dd className={styles.statValue}>{asMoney(summary.saleRevenueMinor, summary.currency)}</dd></div>
            <div className={styles.stat}><dt className={styles.statLabel}>Waste cost</dt><dd className={styles.statValue}>{asMoney(summary.wasteCostMinor, summary.currency)}</dd></div>
            <div className={styles.stat}><dt className={styles.statLabel}>Sales with unknown price</dt><dd className={styles.statValue}>{summary.unknownPrices}</dd><span className={styles.statUnit}>records</span></div>
            <div className={styles.stat}><dt className={styles.statLabel}>Movements with unknown cost</dt><dd className={styles.statValue}>{summary.unknownCosts}</dd><span className={styles.statUnit}>records</span></div>
          </dl>
          <h3 className={styles.subhead}>Recorded quantities by unit</h3>
          {Object.keys(summary.quantityByUnit).length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Unit</th><th className={styles.right}>Sold</th><th className={styles.right}>Wasted</th></tr></thead><tbody>{Object.entries(summary.quantityByUnit).sort(([a], [b]) => a.localeCompare(b)).map(([unit, amounts]) => <tr key={unit}><td>{unit}</td><td className={styles.right}>{amounts.sold}</td><td className={styles.right}>{amounts.wasted}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No recorded sale or waste quantities in this period.</p>}
          <h3 className={styles.subhead}>Completeness notes</h3>
          <div className={styles.notice}>
            <div>These figures describe ledger records in the selected period; absent history is not treated as zero activity.</div>
            {summary.unknownPrices > 0 && <div>{summary.unknownPrices} sale movement(s) have no recorded price.</div>}
            {summary.unknownCosts > 0 && <div>{summary.unknownCosts} movement(s) have no recorded cost.</div>}
            {summary.limitations.length > 0 ? summary.limitations.map((item, index) => <div key={`${index}-${item}`}>{item}</div>) : <div>No additional limitations were returned by the operations service.</div>}
          </div>
          <h3 className={styles.subhead}>Daily recorded amounts</h3>
          {chartRows.length ? (
            <div className={styles.chart}>
              <svg viewBox={`0 0 ${Math.max(440, chartRows.length * 54)} 168`} role="img" aria-label={`Recorded daily sale revenue and waste cost from ${from} to ${to}`}>
                <line x1="24" y1="134" x2={Math.max(420, chartRows.length * 54 - 10)} y2="134" stroke="#dfe7e1" />
                {chartRows.map((row, index) => {
                  const x = 32 + index * 54;
                  const saleHeight = row.revenueMinor === null ? 0 : Math.max(1, row.revenueMinor / maxValue * 104);
                  const wasteHeight = row.wasteCostMinor === null ? 0 : Math.max(1, row.wasteCostMinor / maxValue * 104);
                  return <g key={row.date}>
                    <title>{row.date}: revenue {asMoney(row.revenueMinor, summary.currency)}, waste cost {asMoney(row.wasteCostMinor, summary.currency)}</title>
                    {row.revenueMinor !== null && <rect x={x} y={134 - saleHeight} width="14" height={saleHeight} rx="2" fill="#4a8a64" />}
                    {row.wasteCostMinor !== null && <rect x={x + 17} y={134 - wasteHeight} width="14" height={wasteHeight} rx="2" fill="#cc8450" />}
                    <text x={x + 15} y="151" textAnchor="middle" fill="#68766d" fontSize="9">{row.date.slice(5)}</text>
                  </g>;
                })}
              </svg>
              <div className={styles.chartLegend}><span className={styles.legendItem}><i className={styles.legendMark} />Sale revenue</span><span className={styles.legendItem}><i className={styles.legendMarkWaste} />Waste cost</span></div>
            </div>
          ) : <p className={styles.empty}>No daily records in this date range.</p>}
          <div className={styles.actions}><button type="button" className={styles.button} onClick={() => onExplain({ from, to })} disabled={!data || loading || Boolean(busy)}><MessageSquareText size={14} aria-hidden="true" />Ask the sidebar assistant about this period</button></div>
          <h3 className={styles.subhead}>Record a stock movement</h3>
          <form onSubmit={(event) => void submitMovement(event)}>
            <div className={styles.grid}>
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-kind`}>Movement</label><select id={`${assistantRequestId}-kind`} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="sale">Sale</option><option value="waste">Waste</option><option value="adjustment">Adjustment</option></select></div>
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-product`}>Product</label><select id={`${assistantRequestId}-product`} value={productId} onChange={(event) => { setProductId(event.target.value); setBatchId(""); }} required><option value="">Choose recorded product</option>{sortedProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></div>
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-batch`}>Recorded batch</label><select id={`${assistantRequestId}-batch`} value={batchId} onChange={(event) => setBatchId(event.target.value)} required disabled={!selectedProduct}><option value="">Choose recorded batch</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.id} · {batch.quantity} {selectedProduct?.unit}</option>)}</select></div>
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-quantity`}>Quantity {kind === "adjustment" ? "(signed)" : "(positive)"}</label><input id={`${assistantRequestId}-quantity`} type="number" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></div>
              {kind === "sale" && <div className={styles.field}><label htmlFor={`${assistantRequestId}-price`}>Unit sale price <span className={styles.muted}>(optional)</span></label><input id={`${assistantRequestId}-price`} inputMode="decimal" placeholder="e.g. 3.50" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /><span className={styles.muted}>Amount in {summary.currency}; up to 2 decimal places.</span></div>}
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-cost`}>Unit cost <span className={styles.muted}>(optional)</span></label><input id={`${assistantRequestId}-cost`} inputMode="decimal" placeholder="e.g. 2.10" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /><span className={styles.muted}>Leave blank if not verified.</span></div>
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-time`}>Occurred at</label><input id={`${assistantRequestId}-time`} type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></div>
              <div className={styles.field}><label htmlFor={`${assistantRequestId}-reason`}>Reason</label><input id={`${assistantRequestId}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} required /></div>
            </div>
            {formError && <div className={styles.feedback} role="alert">{formError}</div>}
            {notice && <div className={`${styles.feedback} ${styles.success}`} role="status">{notice}</div>}
            <div className={styles.actions}><button className={`${styles.button} ${styles.primary}`} type="submit" disabled={!!busy}>{busy === "movement" ? "Recording…" : "Record movement"}</button>{retryRequestId.current && <span className={styles.muted}>Retry will use the same request reference.</span>}</div>
          </form>
          <h3 className={styles.subhead}>Movement history <span className={styles.badge}>{movements.length}</span></h3>
          {movements.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>When</th><th>Record</th><th>Product / batch</th><th className={styles.right}>Quantity</th><th>Reason</th><th>Action</th></tr></thead><tbody>{[...movements].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((movement) => <tr key={movement.id}><td>{displayDate(movement.occurredAt)}</td><td><span className={styles.badge}>{movement.kind}</span>{movement.reversesId && <div className={styles.muted}>Reversal</div>}</td><td>{movement.productName}<div className={styles.muted}>{movement.batchId} · {movement.sku}</div></td><td className={styles.right}>{movement.quantity} {movement.unit}</td><td>{movement.reason}</td><td>{movement.kind !== "reversal" && !movement.reversesId && <button type="button" className={`${styles.button} ${styles.danger}`} disabled={!!busy} onClick={() => void reverseMovement(movement)} aria-label={`Reverse movement for ${movement.productName}`}><RotateCcw size={13} aria-hidden="true" />Reverse</button>}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No movements recorded for this period.</p>}
        </div>
      )}
    </section>
  );
}

type LegacyCleanupReport = {
  digest: string;
  removeBatches: string[];
  removeRecommendations: string[];
  removeActivity: string[];
  reviewRequired: string[];
  preservedInvoices: number;
  preservedTasks: number;
  needsExplicitConfirmation: true;
};

/** Owner Settings review for proven initial-fixture cleanup; onChanged refreshes the host state after the confirmed transaction. */
export function LegacyCleanupReview({ onChanged }: { onChanged: () => void }) {
  const [report, setReport] = useState<LegacyCleanupReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const id = useId();

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiJson<{ report: LegacyCleanupReport | null }>("/api/migration");
      setReport(result.report);
    } catch (reason) {
      setReport(null);
      setError(reason instanceof Error ? reason.message : "Could not load the cleanup review.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadReport(); }, [loadReport]);

  async function confirmCleanup() {
    if (!report || !report.needsExplicitConfirmation || busy) return;
    const eligible = [
      `Batches: ${report.removeBatches.length ? report.removeBatches.join(", ") : "none"}`,
      `Recommendations: ${report.removeRecommendations.length ? report.removeRecommendations.join(", ") : "none"}`,
      `Activity records: ${report.removeActivity.length ? report.removeActivity.join(", ") : "none"}`,
    ].join("\n");
    const confirmation = [
      "This operation will remove only the exact eligible records listed below.",
      eligible,
      `${report.reviewRequired.length} record(s) requiring manual provenance review will be retained.`,
      `${report.preservedInvoices} invoice(s) and ${report.preservedTasks} task(s) are preserved.`,
      "The backend writes a full original-state backup in the same transaction.",
      `Report digest: ${report.digest}`,
      "This cleanup is not a production-readiness check.",
      "Continue?",
    ].join("\n\n");
    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await apiJson<{ backupId: string }>("/api/migration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, digest: report.digest }),
      });
      setSuccess(`Cleanup completed. The original state was backed up in the same transaction (backup ${result.backupId}).`);
      onChanged();
      await loadReport();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reviewed cleanup was not applied.");
    } finally {
      setBusy(false);
    }
  }

  const eligibleCount = report
    ? report.removeBatches.length + report.removeRecommendations.length + report.removeActivity.length
    : 0;
  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title} id={`${id}-title`}>Legacy sample cleanup review</h2>
          <p className={styles.subtitle}>Inspect exact initial-fixture matches before making any change.</p>
        </div>
        <button type="button" className={styles.button} onClick={() => void loadReport()} disabled={loading || busy}>
          <RefreshCw size={14} aria-hidden="true" />Refresh report
        </button>
      </header>
      {error && <div className={styles.feedback} role="alert">{error}</div>}
      {success && <div className={`${styles.feedback} ${styles.success}`} role="status">{success}</div>}
      {loading ? (
        <div className={styles.loading} aria-label="Loading cleanup report" aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div>
      ) : report ? (
        <div className={styles.body}>
          <div className={styles.notice}>
            <ShieldAlert size={15} aria-hidden="true" /> No records are removed automatically. Only exact, proven initial fixture matches are eligible; ambiguous or referenced records remain for manual review. This is not a statement that the workspace is production-ready.
          </div>
          <div className={styles.infoRows}>
            <div className={styles.infoCell}><div className={styles.infoLabel}>Preserved invoices</div><div className={styles.infoValue}>{report.preservedInvoices}</div></div>
            <div className={styles.infoCell}><div className={styles.infoLabel}>Preserved staff tasks</div><div className={styles.infoValue}>{report.preservedTasks}</div></div>
            <div className={styles.infoCell}><div className={styles.infoLabel}>Manual review exclusions</div><div className={styles.infoValue}>{report.reviewRequired.length}</div></div>
          </div>
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Confirmation writes a full backup of the original state in the same database transaction before committing the reviewed cleanup. If the report changes, the backend rejects this digest and requires a fresh review.
          </p>
          <p className={styles.muted} style={{ marginTop: 6, overflowWrap: "anywhere" }}>Report digest: <span className={styles.small}>{report.digest}</span></p>

          <h3 className={styles.subhead}><Trash2 size={14} aria-hidden="true" /> Exact eligible records <span className={styles.badge}>{eligibleCount}</span></h3>
          <div className={styles.stack}>
            <div className={styles.record}>
              <strong className={styles.recordTitle}>Stock batches</strong>
              {report.removeBatches.length ? <ul className={styles.evidence}>{report.removeBatches.map((record) => <li key={record}><code>{record}</code></li>)}</ul> : <p className={styles.muted}>No batches qualify.</p>}
            </div>
            <div className={styles.record}>
              <strong className={styles.recordTitle}>Recommendations</strong>
              {report.removeRecommendations.length ? <ul className={styles.evidence}>{report.removeRecommendations.map((record) => <li key={record}><code>{record}</code></li>)}</ul> : <p className={styles.muted}>No recommendations qualify.</p>}
            </div>
            <div className={styles.record}>
              <strong className={styles.recordTitle}>Activity records</strong>
              {report.removeActivity.length ? <ul className={styles.evidence}>{report.removeActivity.map((record) => <li key={record}><code>{record}</code></li>)}</ul> : <p className={styles.muted}>No activity records qualify.</p>}
            </div>
          </div>

          <h3 className={styles.subhead}><Database size={14} aria-hidden="true" /> Retained for manual provenance review <span className={styles.badge}>{report.reviewRequired.length}</span></h3>
          {report.reviewRequired.length ? (
            <ul className={styles.evidence}>{report.reviewRequired.map((record, index) => <li key={`${index}-${record}`}>{record}</li>)}</ul>
          ) : <p className={styles.muted}>No records were excluded for manual review.</p>}

          {eligibleCount > 0 ? (
            <div className={styles.actions}>
              <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy || !report.needsExplicitConfirmation} onClick={() => void confirmCleanup()}>
                {busy ? "Applying reviewed cleanup…" : "Review and confirm cleanup"}
              </button>
              <span className={styles.muted}>A browser confirmation is required; this action is never automatic.</span>
            </div>
          ) : (
            <div className={styles.notice} style={{ marginTop: 12 }}>No records are eligible for automatic removal. This panel will not submit an empty cleanup.</div>
          )}
        </div>
      ) : (
        <div className={styles.empty}><Database size={20} aria-hidden="true" /><p>No stored business state is available for a cleanup review.</p></div>
      )}
    </section>
  );
}

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
function getBusinessToday(timeZone = "Asia/Kuala_Lumpur") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function daysEarlier(days: number, fromDate?: string) {
  const base = fromDate ? new Date(`${fromDate}T00:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}
function formatChartDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate.slice(5);
  return date.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
}
function roundToCeiling(value: number): number {
  if (value <= 0) return 10;
  if (value <= 10) return 10;
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  if (value <= 250) return 250;
  if (value <= 500) return 500;
  if (value <= 1000) return 1000;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / power) * power;
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
export function InsightsPanel({ products, onChanged, onExplain, timeZone = "Asia/Kuala_Lumpur" }: {
  products: Product[];
  onChanged: () => void;
  onExplain: (range: { from: string; to: string }) => void;
  timeZone?: string;
}) {
  const [to, setTo] = useState(() => getBusinessToday(timeZone));
  const [from, setFrom] = useState(() => daysEarlier(29, getBusinessToday(timeZone)));
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Chart settings
  const [chartMetric, setChartMetric] = useState<"cost" | "quantity">("cost");
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);

  // Recording workflow state
  const [workflow, setWorkflow] = useState<"waste" | "correction">("waste");

  // Waste form state
  const [wasteProductId, setWasteProductId] = useState("");
  const [wasteBatchId, setWasteBatchId] = useState("");
  const [wasteQuantity, setWasteQuantity] = useState("");
  const [wasteUnitCost, setWasteUnitCost] = useState("");
  const [wasteReasonPreset, setWasteReasonPreset] = useState("Expired / past shelf life");
  const [wasteReasonCustom, setWasteReasonCustom] = useState("");
  const [wasteOccurredAt, setWasteOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));

  // Correction form state
  const [corrProductId, setCorrProductId] = useState("");
  const [corrBatchId, setCorrBatchId] = useState("");
  const [corrCount, setCorrCount] = useState("");
  const [corrUnitCost, setCorrUnitCost] = useState("");
  const [corrReasonPreset, setCorrReasonPreset] = useState("Physical stock-take discrepancy");
  const [corrReasonCustom, setCorrReasonCustom] = useState("");
  const [corrOccurredAt, setCorrOccurredAt] = useState(() => new Date().toISOString().slice(0, 16));

  const [movementSearch, setMovementSearch] = useState("");
  const [movementKindFilter, setMovementKindFilter] = useState<string>("all");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const retryRequestId = useRef<string | null>(null);
  const reversalRequests = useRef<Record<string, string>>({});
  const assistantRequestId = useId();

  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);

  // Selected products and batches
  const selectedWasteProduct = products.find((p) => p.id === wasteProductId);
  const wasteBatches = selectedWasteProduct?.batches ?? [];
  const selectedWasteBatch = wasteBatches.find((b) => b.id === wasteBatchId);

  const selectedCorrProduct = products.find((p) => p.id === corrProductId);
  const corrBatches = selectedCorrProduct?.batches ?? [];
  const selectedCorrBatch = corrBatches.find((b) => b.id === corrBatchId);

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

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("freshflow-stored-state");
    const onMessage = (event: MessageEvent) => {
      if (event.data === "changed") {
        void load();
      }
    };
    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
    };
  }, [load]);

  async function submitWaste(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    try {
      const amount = Number(wasteQuantity);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive waste quantity.");
      if (!selectedWasteProduct || !selectedWasteBatch) throw new Error("Choose a product and recorded batch.");
      if (amount > selectedWasteBatch.quantity) {
        throw new Error(`Waste quantity cannot exceed current batch stock (${selectedWasteBatch.quantity} ${selectedWasteProduct.unit}).`);
      }
      const finalReason = wasteReasonPreset === "Other" ? wasteReasonCustom.trim() : (wasteReasonCustom.trim() ? `${wasteReasonPreset}: ${wasteReasonCustom.trim()}` : wasteReasonPreset);
      if (!finalReason) throw new Error("Specify a reason for recording this waste.");
      const costMinor = decimalToMinor(wasteUnitCost);
      if (costMinor !== undefined && costMinor < 0) throw new Error("Unit cost cannot be negative.");
      const parsedTime = new Date(wasteOccurredAt);
      if (Number.isNaN(parsedTime.getTime())) throw new Error("Choose a valid occurrence time.");

      const requestId = retryRequestId.current ?? crypto.randomUUID();
      retryRequestId.current = requestId;
      setBusy("movement");

      await apiJson<OperationsResponse>("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "record_movement",
          payload: {
            requestId,
            kind: "waste",
            productId: wasteProductId,
            batchId: wasteBatchId,
            quantity: amount,
            ...(costMinor === undefined ? {} : { unitCostMinor: costMinor }),
            reason: finalReason,
            occurredAt: parsedTime.toISOString(),
          },
        }),
      });

      retryRequestId.current = null;
      setNotice(`Waste recorded: ${amount} ${selectedWasteProduct.unit} written down from ${selectedWasteProduct.name}.`);
      setWasteQuantity("");
      setWasteReasonCustom("");

      const occurredDate = parsedTime.toISOString().slice(0, 10);
      if (occurredDate > to) {
        setTo(occurredDate);
      }
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        new BroadcastChannel("freshflow-stored-state").postMessage("changed");
      }

      await load();
      onChanged();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Waste could not be recorded.");
    } finally {
      setBusy("");
    }
  }

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    try {
      const count = Number(corrCount);
      if (!Number.isFinite(count) || count < 0) throw new Error("Enter a valid non-negative actual physical count.");
      if (!selectedCorrProduct || !selectedCorrBatch) throw new Error("Choose a product and recorded batch to correct.");
      const prev = selectedCorrBatch.quantity;
      if (Math.abs(count - prev) < 0.0001) throw new Error("Actual count matches the recorded stock. No discrepancy to correct.");
      const finalReason = corrReasonPreset === "Other" ? corrReasonCustom.trim() : (corrReasonCustom.trim() ? `${corrReasonPreset}: ${corrReasonCustom.trim()}` : corrReasonPreset);
      if (!finalReason) throw new Error("A reason is mandatory for inventory discrepancy corrections.");
      const costMinor = decimalToMinor(corrUnitCost);
      if (costMinor !== undefined && costMinor < 0) throw new Error("Unit cost cannot be negative.");
      const parsedTime = new Date(corrOccurredAt);
      if (Number.isNaN(parsedTime.getTime())) throw new Error("Choose a valid occurrence time.");

      const requestId = retryRequestId.current ?? crypto.randomUUID();
      retryRequestId.current = requestId;
      setBusy("movement");

      await apiJson<OperationsResponse>("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "record_movement",
          payload: {
            requestId,
            kind: "adjustment",
            productId: corrProductId,
            batchId: corrBatchId,
            correctedQuantity: count,
            ...(costMinor === undefined ? {} : { unitCostMinor: costMinor }),
            reason: finalReason,
            occurredAt: parsedTime.toISOString(),
          },
        }),
      });

      retryRequestId.current = null;
      const diff = Math.round((count - prev) * 10000) / 10000;
      setNotice(`Stock corrected: ${selectedCorrProduct.name} batch ${corrBatchId} adjusted from ${prev} to ${count} ${selectedCorrProduct.unit} (${diff > 0 ? "+" : ""}${diff} ${selectedCorrProduct.unit}).`);
      setCorrCount("");
      setCorrReasonCustom("");

      const occurredDate = parsedTime.toISOString().slice(0, 10);
      if (occurredDate > to) {
        setTo(occurredDate);
      }
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        new BroadcastChannel("freshflow-stored-state").postMessage("changed");
      }

      await load();
      onChanged();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Correction could not be recorded.");
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
    if (!window.confirm(`Reverse this ${movement.kind} record? A reversal record will be added; original history is preserved.`)) return;
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

      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        new BroadcastChannel("freshflow-stored-state").postMessage("changed");
      }

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
  const rawMaxWasteValue = Math.max(0, ...chartRows.map((row) => {
    if (chartMetric === "cost") {
      return row.wasteCostMinor !== null ? row.wasteCostMinor / 100 : 0;
    }
    return row.waste;
  }));
  const chartYMax = roundToCeiling(rawMaxWasteValue > 0 ? rawMaxWasteValue : (chartMetric === "cost" ? 100 : 10));
  const yIntervals = [0, chartYMax * 0.25, chartYMax * 0.5, chartYMax * 0.75, chartYMax];

  const marginLeft = 68;
  const marginRight = 24;
  const marginTop = 24;
  const chartHeight = 150;
  const marginBottom = 42;
  const totalHeight = marginTop + chartHeight + marginBottom;
  const minWidth = 560;
  const slotWidth = Math.max(48, Math.floor((minWidth - marginLeft - marginRight) / Math.max(chartRows.length, 1)));
  const chartWidth = Math.max(minWidth, marginLeft + marginRight + chartRows.length * slotWidth);
  const barWidth = Math.min(26, Math.max(14, Math.floor(slotWidth * 0.52)));
  const labelStep = chartRows.length > 35 ? Math.ceil(chartRows.length / 20) : (chartRows.length > 18 ? 2 : 1);

  const movements = useMemo(() => {
    const list = data?.movements ?? [];
    return list.filter((m) => {
      if (movementKindFilter !== "all" && m.kind !== movementKindFilter) return false;
      if (!movementSearch.trim()) return true;
      const q = movementSearch.toLowerCase().trim();
      return (
        m.productName.toLowerCase().includes(q) ||
        m.sku.toLowerCase().includes(q) ||
        m.batchId.toLowerCase().includes(q) ||
        m.reason.toLowerCase().includes(q)
      );
    });
  }, [data?.movements, movementKindFilter, movementSearch]);

  const rawMovementsCount = data?.movements?.length ?? 0;

  // Real-time correction preview
  const corrPrevQty = selectedCorrBatch?.quantity ?? null;
  const corrParsedCount = Number(corrCount);
  const corrDiff = corrPrevQty !== null && Number.isFinite(corrParsedCount) && corrCount.trim() !== ""
    ? Math.round((corrParsedCount - corrPrevQty) * 10000) / 10000
    : null;

  return (
    <section className={styles.panel} aria-labelledby={`${assistantRequestId}-title`}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title} id={`${assistantRequestId}-title`}>Waste Insights</h2>
          <p className={styles.subtitle}>Documented waste and inventory adjustments from verified store operations. Missing history and unverified costs stay undisclosed rather than assumed to be zero.</p>
        </div>
        <button type="button" className={styles.button} onClick={() => void load()} disabled={loading}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
      </header>

      <div className={styles.body}>
        <div className={styles.filterRow}>
          <div className={styles.field}>
            <label htmlFor={`${assistantRequestId}-from`}>From</label>
            <input id={`${assistantRequestId}-from`} type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${assistantRequestId}-to`}>To</label>
            <input id={`${assistantRequestId}-to`} type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className={styles.quickRange}>
            <button type="button" className={styles.quickBtn} onClick={() => { const today = getBusinessToday(timeZone); setFrom(daysEarlier(6, today)); setTo(today); }}>7 days</button>
            <button type="button" className={styles.quickBtn} onClick={() => { const today = getBusinessToday(timeZone); setFrom(daysEarlier(29, today)); setTo(today); }}>30 days</button>
            <button type="button" className={styles.quickBtn} onClick={() => { const today = getBusinessToday(timeZone); setFrom(daysEarlier(89, today)); setTo(today); }}>90 days</button>
          </div>
        </div>
      </div>

      {error && <div className={styles.feedback} role="alert">{error} <button className={styles.button} type="button" onClick={() => void load()}>Retry</button></div>}

      {loading ? (
        <div className={styles.loading} aria-busy="true" aria-label="Loading insights">
          <div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} />
        </div>
      ) : summary && (
        <div className={styles.body}>
          {/* Waste Stats */}
          <dl className={styles.statGrid}>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Verified waste cost</dt>
              <dd className={styles.statValue}>{asMoney(summary.wasteCostMinor, summary.currency)}</dd>
            </div>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Recorded waste events</dt>
              <dd className={styles.statValue}>{summary.wasteByReason?.reduce((sum, r) => sum + r.count, 0) || (summary.wasteUnits > 0 ? summary.daily.reduce((acc, d) => acc + (d.waste > 0 ? 1 : 0), 0) : 0)}</dd>
              <span className={styles.statUnit}>operations</span>
            </div>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Waste with unknown cost</dt>
              <dd className={styles.statValue}>{summary.unknownCosts}</dd>
              <span className={styles.statUnit}>records</span>
            </div>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Units with recorded waste</dt>
              <dd className={styles.statValue}>{Object.keys(summary.quantityByUnit).length}</dd>
              <span className={styles.statUnit}>distinct units</span>
            </div>
          </dl>

          {/* Quantities by Unit */}
          <h3 className={styles.subhead}>Recorded waste quantities by unit</h3>
          {Object.keys(summary.quantityByUnit).length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th className={styles.right}>Wasted quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.quantityByUnit).sort(([a], [b]) => a.localeCompare(b)).map(([unit, amounts]) => (
                    <tr key={unit}>
                      <td>{unit}</td>
                      <td className={styles.right}>{amounts.wasted} {unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>No recorded waste quantities in this period.</p>
          )}

          {/* Product-level breakdown */}
          {summary.productBreakdown && summary.productBreakdown.length > 0 && (
            <>
              <h3 className={styles.subhead}>Product-level waste breakdown</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th className={styles.right}>Quantity wasted</th>
                      <th className={styles.right}>Verified waste cost</th>
                      <th className={styles.right}>Waste events</th>
                      <th className={styles.right}>Unverified costs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.productBreakdown.map((item) => (
                      <tr key={item.productId}>
                        <td><strong>{item.productName}</strong></td>
                        <td><code>{item.sku}</code></td>
                        <td className={styles.right}>{item.wastedQuantity} {item.unit}</td>
                        <td className={styles.right}>{asMoney(item.wasteCostMinor, summary.currency)}</td>
                        <td className={styles.right}>{item.wasteEventsCount}</td>
                        <td className={styles.right}>{item.unknownCostCount > 0 ? <span className={styles.muted}>{item.unknownCostCount} record(s)</span> : "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Waste by Reason */}
          {summary.wasteByReason && summary.wasteByReason.length > 0 && (
            <>
              <h3 className={styles.subhead}>Waste by reason</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th className={styles.right}>Events</th>
                      <th>Quantities by unit</th>
                      <th className={styles.right}>Verified cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.wasteByReason.map((item) => (
                      <tr key={item.reason}>
                        <td><strong>{item.reason}</strong></td>
                        <td className={styles.right}>{item.count}</td>
                        <td>
                          {Object.entries(item.quantityByUnit).map(([unit, qty]) => (
                            <span key={unit} style={{ marginRight: 8 }}>{qty} {unit}</span>
                          ))}
                        </td>
                        <td className={styles.right}>{asMoney(item.costMinor, summary.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Completeness Notes */}
          <h3 className={styles.subhead}>Completeness notes</h3>
          <div className={styles.notice}>
            <div>These figures describe ledger records in the selected period; absent history is not treated as zero waste.</div>
            {summary.unknownCosts > 0 && <div>{summary.unknownCosts} waste record(s) have no verified unit cost.</div>}
            {summary.limitations.length > 0 ? (
              summary.limitations.map((item, index) => <div key={`${index}-${item}`}>{item}</div>)
            ) : (
              <div>No additional limitations were returned by the operations service.</div>
            )}
          </div>

          {/* Daily Waste Trends */}
          <div className={styles.chartHeader}>
            <h3 className={styles.subhead} style={{ margin: 0 }}>Daily recorded waste trends</h3>
            <div className={styles.metricToggle} role="group" aria-label="Waste metric toggle">
              <button
                type="button"
                className={`${styles.metricBtn} ${chartMetric === "cost" ? styles.metricBtnActive : ""}`}
                onClick={() => setChartMetric("cost")}
              >
                Waste cost ({summary.currency})
              </button>
              <button
                type="button"
                className={`${styles.metricBtn} ${chartMetric === "quantity" ? styles.metricBtnActive : ""}`}
                onClick={() => setChartMetric("quantity")}
              >
                Waste quantity (units)
              </button>
            </div>
          </div>

          {chartRows.length > 0 ? (
            <div className={styles.chartScroll}>
              <svg
                viewBox={`0 0 ${chartWidth} ${totalHeight}`}
                role="img"
                aria-label={`Recorded daily waste from ${from} to ${to}`}
                style={{ width: "100%", minWidth: `${chartWidth}px`, height: "auto", display: "block" }}
              >
                {/* Horizontal gridlines & Y-axis labels */}
                {yIntervals.map((val, idx) => {
                  const y = marginTop + chartHeight - (val / chartYMax) * chartHeight;
                  const label = chartMetric === "cost"
                    ? `${summary.currency} ${val.toLocaleString("en-MY", { maximumFractionDigits: val % 1 === 0 ? 0 : 2 })}`
                    : `${val.toLocaleString("en-MY")}${idx === yIntervals.length - 1 ? " units" : ""}`;
                  return (
                    <g key={`y-${idx}`}>
                      <line
                        x1={marginLeft}
                        y1={y}
                        x2={chartWidth - marginRight}
                        y2={y}
                        stroke={idx === 0 ? "#b0bcc6" : "#edf1ed"}
                        strokeDasharray={idx === 0 ? undefined : "3 3"}
                      />
                      <text
                        x={marginLeft - 8}
                        y={y + 3.5}
                        textAnchor="end"
                        fill="#68766d"
                        fontSize="10"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* X-axis baseline */}
                <line
                  x1={marginLeft}
                  y1={marginTop + chartHeight}
                  x2={chartWidth - marginRight}
                  y2={marginTop + chartHeight}
                  stroke="#b0bcc6"
                  strokeWidth="1.2"
                />

                {/* Bars & X-axis date labels */}
                {chartRows.map((row, index) => {
                  const centerX = marginLeft + index * slotWidth + slotWidth / 2;
                  const barX = centerX - barWidth / 2;
                  const isHovered = hoveredBarIndex === index;

                  if (chartMetric === "cost") {
                    const hasCost = row.wasteCostMinor !== null;
                    const costVal = hasCost ? row.wasteCostMinor! / 100 : 0;
                    const isUnknownCost = !hasCost && row.waste > 0;
                    const barHeight = costVal <= 0 ? (isUnknownCost ? 8 : 0) : Math.max(4, (costVal / chartYMax) * chartHeight);
                    const barY = marginTop + chartHeight - barHeight;

                    return (
                      <g key={row.date}>
                        {isUnknownCost && (
                          <rect
                            x={barX}
                            y={barY}
                            width={barWidth}
                            height={barHeight}
                            rx="3"
                            fill="#fdf2e9"
                            stroke="#cc8450"
                            strokeDasharray="2 2"
                          />
                        )}
                        {!isUnknownCost && barHeight > 0 && (
                          <rect
                            x={barX}
                            y={barY}
                            width={barWidth}
                            height={barHeight}
                            rx="3"
                            fill={isHovered ? "#b35a26" : "#cc8450"}
                          />
                        )}
                        <line x1={centerX} y1={marginTop + chartHeight} x2={centerX} y2={marginTop + chartHeight + 4} stroke="#b0bcc6" />
                        {(index % labelStep === 0 || index === chartRows.length - 1) && (
                          <text x={centerX} y={marginTop + chartHeight + 17} textAnchor="middle" fill="#68766d" fontSize="9.5">
                            {formatChartDate(row.date)}
                          </text>
                        )}
                        {/* Interactive hit target */}
                        <rect
                          x={marginLeft + index * slotWidth}
                          y={marginTop}
                          width={slotWidth}
                          height={chartHeight + 20}
                          fill="transparent"
                          style={{ cursor: "pointer" }}
                          onMouseEnter={() => setHoveredBarIndex(index)}
                          onMouseLeave={() => setHoveredBarIndex(null)}
                        />
                      </g>
                    );
                  }

                  const qtyVal = row.waste;
                  const barHeight = qtyVal <= 0 ? 0 : Math.max(4, (qtyVal / chartYMax) * chartHeight);
                  const barY = marginTop + chartHeight - barHeight;

                  return (
                    <g key={row.date}>
                      {barHeight > 0 && (
                        <rect
                          x={barX}
                          y={barY}
                          width={barWidth}
                          height={barHeight}
                          rx="3"
                          fill={isHovered ? "#26543c" : "#3b7a57"}
                        />
                      )}
                      <line x1={centerX} y1={marginTop + chartHeight} x2={centerX} y2={marginTop + chartHeight + 4} stroke="#b0bcc6" />
                      {(index % labelStep === 0 || index === chartRows.length - 1) && (
                        <text x={centerX} y={marginTop + chartHeight + 17} textAnchor="middle" fill="#68766d" fontSize="9.5">
                          {formatChartDate(row.date)}
                        </text>
                      )}
                      <rect
                        x={marginLeft + index * slotWidth}
                        y={marginTop}
                        width={slotWidth}
                        height={chartHeight + 20}
                        fill="transparent"
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHoveredBarIndex(index)}
                        onMouseLeave={() => setHoveredBarIndex(null)}
                      />
                    </g>
                  );
                })}

                {/* Floating Tooltip Card */}
                {hoveredBarIndex !== null && chartRows[hoveredBarIndex] && (() => {
                  const row = chartRows[hoveredBarIndex];
                  const hCenterX = marginLeft + hoveredBarIndex * slotWidth + slotWidth / 2;
                  const tooltipWidth = 175;
                  const tooltipHeight = 58;
                  const clampedX = Math.max(marginLeft, Math.min(chartWidth - marginRight - tooltipWidth, hCenterX - tooltipWidth / 2));
                  const tooltipY = Math.max(4, marginTop - 16);
                  return (
                    <g pointerEvents="none">
                      <rect x={clampedX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" fill="#1d2025" opacity="0.96" />
                      <text x={clampedX + 10} y={tooltipY + 16} fill="#ffffff" fontSize="10.5" fontWeight="600">{formatChartDate(row.date)}</text>
                      <text x={clampedX + 10} y={tooltipY + 32} fill="#dfe7e1" fontSize="10">Waste recorded: {row.waste} units</text>
                      <text x={clampedX + 10} y={tooltipY + 47} fill={row.wasteCostMinor !== null ? "#f5cba7" : "#e0a080"} fontSize="10">
                        {row.wasteCostMinor !== null ? `Verified cost: ${asMoney(row.wasteCostMinor, summary.currency)}` : "Verified cost: unverified"}
                      </text>
                    </g>
                  );
                })()}
              </svg>

              <div className={styles.chartLegend} style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "11.5px", color: "#68766d", flexWrap: "wrap", padding: "0 6px" }}>
                <span className={styles.legendItem} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: chartMetric === "cost" ? "#cc8450" : "#3b7a57" }} />
                  {chartMetric === "cost" ? `Verified daily waste cost (${summary.currency})` : "Daily recorded waste quantity (units)"}
                </span>
                {chartMetric === "cost" && summary.unknownCosts > 0 && (
                  <span className={styles.legendItem} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: "#fdf2e9", border: "1px dashed #cc8450" }} />
                    Waste events with unknown/unverified cost
                  </span>
                )}
                {!chartRows.some((r) => r.waste > 0 || r.wasteCostMinor !== null) && (
                  <span className={styles.muted}>No waste events recorded in the ledger for this date range.</span>
                )}
              </div>
            </div>
          ) : (
            <p className={styles.empty}>No daily waste records in this date range.</p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => onExplain({ from, to })} disabled={!data || loading || Boolean(busy)}>
              <MessageSquareText size={14} aria-hidden="true" />Ask the sidebar assistant about waste in this period
            </button>
          </div>

          {/* Dedicated Movement Workflows */}
          <h3 className={styles.subhead}>Inventory operations</h3>
          <div className={styles.tabList} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={workflow === "waste"}
              className={`${styles.tabButton} ${workflow === "waste" ? styles.tabButtonActive : ""}`}
              onClick={() => { setWorkflow("waste"); setFormError(""); setNotice(""); }}
            >
              Record Waste
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workflow === "correction"}
              className={`${styles.tabButton} ${workflow === "correction" ? styles.tabButtonActive : ""}`}
              onClick={() => { setWorkflow("correction"); setFormError(""); setNotice(""); }}
            >
              Stock Discrepancy Correction
            </button>
          </div>

          {workflow === "waste" ? (
            <form onSubmit={(event) => void submitWaste(event)}>
              <p className={styles.muted} style={{ marginBottom: 12 }}>
                Record expired, spoiled, damaged or discarded stock. Reduces batch inventory persistently and creates a traceable waste record.
              </p>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-w-product`}>Product</label>
                  <select
                    id={`${assistantRequestId}-w-product`}
                    value={wasteProductId}
                    onChange={(event) => { setWasteProductId(event.target.value); setWasteBatchId(""); }}
                    required
                  >
                    <option value="">Choose product</option>
                    {sortedProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-w-batch`}>Batch</label>
                  <select
                    id={`${assistantRequestId}-w-batch`}
                    value={wasteBatchId}
                    onChange={(event) => setWasteBatchId(event.target.value)}
                    required
                    disabled={!selectedWasteProduct}
                  >
                    <option value="">Choose recorded batch</option>
                    {wasteBatches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} · {b.quantity} {selectedWasteProduct?.unit} (exp: {b.expiryDate || "no date"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-w-qty`}>
                    Quantity to discard {selectedWasteBatch ? `(max ${selectedWasteBatch.quantity} ${selectedWasteProduct?.unit})` : ""}
                  </label>
                  <input
                    id={`${assistantRequestId}-w-qty`}
                    type="number"
                    step="any"
                    min="0.0001"
                    max={selectedWasteBatch?.quantity ?? undefined}
                    placeholder="e.g. 5"
                    value={wasteQuantity}
                    onChange={(event) => setWasteQuantity(event.target.value)}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-w-cost`}>Verified unit cost <span className={styles.muted}>(optional)</span></label>
                  <input
                    id={`${assistantRequestId}-w-cost`}
                    inputMode="decimal"
                    placeholder="e.g. 2.50"
                    value={wasteUnitCost}
                    onChange={(event) => setWasteUnitCost(event.target.value)}
                  />
                  <span className={styles.muted}>In {summary.currency}. Leave blank if unverified.</span>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-w-preset`}>Waste category</label>
                  <select
                    id={`${assistantRequestId}-w-preset`}
                    value={wasteReasonPreset}
                    onChange={(event) => setWasteReasonPreset(event.target.value)}
                  >
                    <option value="Expired / past shelf life">Expired / past shelf life</option>
                    <option value="Damaged in transit / display">Damaged in transit / display</option>
                    <option value="Spoilage / quality defect">Spoilage / quality defect</option>
                    <option value="Customer return / unsellable">Customer return / unsellable</option>
                    <option value="Pest contamination">Pest contamination</option>
                    <option value="Other">Other reason (specify below)</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-w-custom`}>Reason details</label>
                  <input
                    id={`${assistantRequestId}-w-custom`}
                    placeholder={wasteReasonPreset === "Other" ? "Explain waste reason..." : "Additional details (optional)..."}
                    value={wasteReasonCustom}
                    onChange={(event) => setWasteReasonCustom(event.target.value)}
                    required={wasteReasonPreset === "Other"}
                  />
                </div>
                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor={`${assistantRequestId}-w-time`}>Occurred at</label>
                  <input
                    id={`${assistantRequestId}-w-time`}
                    type="datetime-local"
                    value={wasteOccurredAt}
                    onChange={(event) => setWasteOccurredAt(event.target.value)}
                    required
                  />
                </div>
              </div>

              {formError && <div className={styles.feedback} role="alert">{formError}</div>}
              {notice && <div className={`${styles.feedback} ${styles.success}`} role="status">{notice}</div>}

              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={Boolean(busy)}>
                  {busy === "movement" ? "Recording…" : "Record waste"}
                </button>
                {retryRequestId.current && <span className={styles.muted}>Retry will use the same request reference.</span>}
              </div>
            </form>
          ) : (
            <form onSubmit={(event) => void submitCorrection(event)}>
              <p className={styles.muted} style={{ marginBottom: 12 }}>
                Record verified physical inventory count discrepancies. Preserves the prior quantity, new quantity, delta, and mandatory reason in history.
              </p>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-c-product`}>Product</label>
                  <select
                    id={`${assistantRequestId}-c-product`}
                    value={corrProductId}
                    onChange={(event) => { setCorrProductId(event.target.value); setCorrBatchId(""); }}
                    required
                  >
                    <option value="">Choose product</option>
                    {sortedProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-c-batch`}>Batch</label>
                  <select
                    id={`${assistantRequestId}-c-batch`}
                    value={corrBatchId}
                    onChange={(event) => setCorrBatchId(event.target.value)}
                    required
                    disabled={!selectedCorrProduct}
                  >
                    <option value="">Choose recorded batch</option>
                    {corrBatches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} · Currently: {b.quantity} {selectedCorrProduct?.unit}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCorrBatch && (
                  <div className={`${styles.field} ${styles.full}`}>
                    <div className={styles.infoRows}>
                      <div className={styles.infoCell}>
                        <div className={styles.infoLabel}>Current recorded stock</div>
                        <div className={styles.infoValue}>{selectedCorrBatch.quantity} {selectedCorrProduct?.unit}</div>
                      </div>
                      <div className={styles.infoCell}>
                        <div className={styles.infoLabel}>Batch expiry</div>
                        <div className={styles.infoValue}>{selectedCorrBatch.expiryDate || "None"}</div>
                      </div>
                      <div className={styles.infoCell}>
                        <div className={styles.infoLabel}>Discrepancy preview</div>
                        <div className={styles.infoValue}>
                          {corrDiff === null ? "Enter physical count" : corrDiff === 0 ? "No change (0)" : `${corrDiff > 0 ? "+" : ""}${corrDiff} ${selectedCorrProduct?.unit}`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-c-count`}>
                    Actual physical shelf count {selectedCorrProduct ? `(${selectedCorrProduct.unit})` : ""}
                  </label>
                  <input
                    id={`${assistantRequestId}-c-count`}
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 12"
                    value={corrCount}
                    onChange={(event) => setCorrCount(event.target.value)}
                    required
                  />
                  {corrDiff !== null && corrDiff !== 0 && (
                    <div className={`${styles.diffPreview} ${corrDiff < 0 ? styles.diffNeg : styles.diffPos}`}>
                      {corrDiff < 0 ? `Stock decreases by ${Math.abs(corrDiff)} ${selectedCorrProduct?.unit}` : `Stock increases by ${corrDiff} ${selectedCorrProduct?.unit}`}
                    </div>
                  )}
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-c-cost`}>Verified unit cost <span className={styles.muted}>(optional)</span></label>
                  <input
                    id={`${assistantRequestId}-c-cost`}
                    inputMode="decimal"
                    placeholder="e.g. 2.10"
                    value={corrUnitCost}
                    onChange={(event) => setCorrUnitCost(event.target.value)}
                  />
                  <span className={styles.muted}>In {summary.currency}. Leave blank if unverified.</span>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-c-preset`}>Correction reason</label>
                  <select
                    id={`${assistantRequestId}-c-preset`}
                    value={corrReasonPreset}
                    onChange={(event) => setCorrReasonPreset(event.target.value)}
                  >
                    <option value="Physical stock-take discrepancy">Physical stock-take discrepancy</option>
                    <option value="Misplaced inventory located">Misplaced inventory located</option>
                    <option value="Unrecorded shrinkage / missing">Unrecorded shrinkage / missing</option>
                    <option value="Receiving count error correction">Receiving count error correction</option>
                    <option value="Data entry mistake correction">Data entry mistake correction</option>
                    <option value="Other">Other reason (specify below)</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`${assistantRequestId}-c-custom`}>Reason explanation <span className={styles.muted}>(mandatory)</span></label>
                  <input
                    id={`${assistantRequestId}-c-custom`}
                    placeholder="Detailed explanation of discrepancy..."
                    value={corrReasonCustom}
                    onChange={(event) => setCorrReasonCustom(event.target.value)}
                    required
                  />
                </div>

                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor={`${assistantRequestId}-c-time`}>Occurred at</label>
                  <input
                    id={`${assistantRequestId}-c-time`}
                    type="datetime-local"
                    value={corrOccurredAt}
                    onChange={(event) => setCorrOccurredAt(event.target.value)}
                    required
                  />
                </div>
              </div>

              {formError && <div className={styles.feedback} role="alert">{formError}</div>}
              {notice && <div className={`${styles.feedback} ${styles.success}`} role="status">{notice}</div>}

              <div className={styles.actions}>
                <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={Boolean(busy)}>
                  {busy === "movement" ? "Recording…" : "Record stock correction"}
                </button>
                {retryRequestId.current && <span className={styles.muted}>Retry will use the same request reference.</span>}
              </div>
            </form>
          )}

          {/* Movement History Table */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", margin: "28px 0 10px" }}>
            <h3 className={styles.subhead} style={{ margin: 0 }}>
              Movement history <span className={styles.badge}>{movements.length} of {rawMovementsCount}</span>
            </h3>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                className={styles.input}
                style={{ width: "220px", minHeight: "32px", padding: "4px 8px", fontSize: "12px" }}
                type="search"
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                placeholder="Search movements..."
              />
              <select
                className={styles.select}
                style={{ width: "150px", minHeight: "32px", padding: "4px 8px", fontSize: "12px" }}
                value={movementKindFilter}
                onChange={(e) => setMovementKindFilter(e.target.value)}
              >
                <option value="all">All kinds</option>
                <option value="waste">Waste</option>
                <option value="adjustment">Corrections</option>
                <option value="receipt">Receipts</option>
                <option value="reversal">Reversals</option>
                <option value="sale">Historical sales</option>
              </select>
            </div>
          </div>

          {movements.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kind</th>
                    <th>Product / batch</th>
                    <th className={styles.right}>Quantity change</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...movements].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((movement) => {
                    const badgeClass = movement.kind === "waste"
                      ? styles.badgeWaste
                      : movement.kind === "adjustment"
                      ? styles.badgeAdjustment
                      : movement.kind === "receipt"
                      ? styles.badgeReceipt
                      : movement.kind === "reversal"
                      ? styles.badgeReversal
                      : "";
                    const isCorr = movement.kind === "adjustment" && movement.previousQuantity !== undefined && movement.correctedQuantity !== undefined;
                    return (
                      <tr key={movement.id}>
                        <td>{displayDate(movement.occurredAt)}</td>
                        <td>
                          <span className={`${styles.badge} ${badgeClass}`}>{movement.kind === "adjustment" ? "correction" : movement.kind}</span>
                          {movement.reversesId && <div className={styles.muted}>Reversal</div>}
                        </td>
                        <td>
                          <strong>{movement.productName}</strong>
                          <div className={styles.muted}>{movement.batchId} · {movement.sku}</div>
                        </td>
                        <td className={styles.right}>
                          <strong>{movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity} {movement.unit}</strong>
                          {isCorr && (
                            <div className={styles.muted}>{movement.previousQuantity} → {movement.correctedQuantity} {movement.unit}</div>
                          )}
                        </td>
                        <td>{movement.reason}</td>
                        <td>
                          {movement.kind !== "reversal" && !movement.reversesId && (
                            <button
                              type="button"
                              className={`${styles.button} ${styles.danger}`}
                              disabled={Boolean(busy)}
                              onClick={() => void reverseMovement(movement)}
                              aria-label={`Reverse movement for ${movement.productName}`}
                            >
                              <RotateCcw size={13} aria-hidden="true" />Reverse
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>
              {movementSearch || movementKindFilter !== "all" ? "No matching movements found." : "No movements recorded for this period."}
            </p>
          )}
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

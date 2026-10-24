import { randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { InvoiceProposal } from "@/src/lib/types";

export interface InvoiceExtractionResult {
  proposals: InvoiceProposal[];
  warnings: string[];
}

type CanonicalField =
  | "productName"
  | "sku"
  | "category"
  | "quantity"
  | "unit"
  | "batchId"
  | "expiryDate";

const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  productName: ["product", "productname", "item", "itemname", "description", "itemdescription", "productdescription", "name"],
  sku: ["sku", "itemcode", "productcode", "stockcode", "code"],
  category: ["category", "department", "productcategory"],
  quantity: ["qty", "quantity", "amount", "units"],
  unit: ["unit", "uom", "unitofmeasure", "packsize"],
  batchId: ["batch", "batchid", "lot", "lotid", "lotno", "lotnumber"],
  expiryDate: ["expiry", "expirydate", "expiration", "expirationdate", "bestbefore", "useby"],
};

const FIELD_LABELS: Record<CanonicalField, string[]> = {
  productName: ["product", "product name", "item", "item name", "description", "item description", "product description", "name"],
  sku: ["sku", "item code", "product code", "stock code", "code"],
  category: ["category", "department"],
  quantity: ["qty", "quantity", "amount"],
  unit: ["unit", "uom", "unit of measure"],
  batchId: ["batch", "batch id", "lot", "lot id", "lot no", "lot number"],
  expiryDate: ["expiry", "expiry date", "expiration", "expiration date", "best before", "use by"],
};

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function emptyFields(): Record<CanonicalField, string> {
  return {
    productName: "",
    sku: "",
    category: "",
    quantity: "",
    unit: "",
    batchId: "",
    expiryDate: "",
  };
}

function headerMap(headers: string[]): Map<number, CanonicalField> {
  const result = new Map<number, CanonicalField>();
  headers.forEach((header, index) => {
    const normalized = normalizedHeader(header);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
      CanonicalField,
      string[],
    ][]) {
      if (aliases.includes(normalized)) {
        result.set(index, field);
        break;
      }
    }
  });
  return result;
}

function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 100_000
    ? quantity
    : null;
}

function parseDate(value: string): { value: string; ambiguous: boolean } {
  const normalized = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (iso) {
    const date = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return { value: isValidDate(date) ? date : "", ambiguous: false };
  }

  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(normalized);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (day <= 12 && month <= 12) return { value: "", ambiguous: true };
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { value: isValidDate(date) ? date : "", ambiguous: false };
  }

  const textual = /^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})$/i.exec(normalized);
  if (textual) {
    const monthNames = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    const monthIndex = monthNames.findIndex((month) =>
      month.startsWith(textual[2]!.toLowerCase()),
    );
    if (monthIndex >= 0) {
      const date = `${textual[3]}-${String(monthIndex + 1).padStart(2, "0")}-${textual[1]!.padStart(2, "0")}`;
      return { value: isValidDate(date) ? date : "", ambiguous: false };
    }
  }
  return { value: "", ambiguous: false };
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildProposal(fields: Record<CanonicalField, string>): InvoiceProposal {
  const quantity = parseQuantity(fields.quantity);
  const parsedExpiry = parseDate(fields.expiryDate);
  const issues: string[] = [];
  if (!fields.productName.trim()) issues.push("Product name not found.");
  if (!fields.sku.trim()) issues.push("SKU not found.");
  if (quantity === null) issues.push("Enter a valid positive quantity.");
  if (!fields.unit.trim()) issues.push("Unit not found.");
  if (!fields.batchId.trim()) issues.push("Batch identifier not found.");
  if (!parsedExpiry.value) {
    issues.push(parsedExpiry.ambiguous
      ? "Expiry date is ambiguous; enter the date explicitly."
      : "Expiry date not found.");
  }
  if (!fields.category.trim()) issues.push("Category not found; add one for a new product.");

  return {
    id: `line-${randomUUID()}`,
    productName: fields.productName.trim(),
    sku: fields.sku.trim(),
    category: fields.category.trim(),
    quantity,
    unit: fields.unit.trim(),
    batchId: fields.batchId.trim(),
    expiryDate: parsedExpiry.value,
    status: "pending",
    issues,
  };
}

function proposalsFromRows(
  headers: string[],
  rows: string[][],
): InvoiceProposal[] {
  const fieldsByColumn = headerMap(headers);
  const productColumn = [...fieldsByColumn.values()].includes("productName");
  const quantityColumn = [...fieldsByColumn.values()].includes("quantity");
  if (!productColumn && !quantityColumn) return [];

  return rows
    .map((row) => {
      const fields = emptyFields();
      for (const [column, field] of fieldsByColumn) {
        fields[field] = (row[column] ?? "").trim();
      }
      return fields;
    })
    .filter((fields) => Object.values(fields).some((value) => value.trim()))
    .map(buildProposal);
}

function parseCsvInvoice(bytes: Uint8Array): InvoiceExtractionResult {
  let rows: string[][];
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    rows = parseCsv(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as string[][];
  } catch {
    throw new Error("This CSV could not be read as UTF-8 comma-separated text.");
  }
  if (rows.length < 2) {
    return {
      proposals: [],
      warnings: ["The CSV needs a header row and at least one invoice line."],
    };
  }
  const proposals = proposalsFromRows(rows[0]!, rows.slice(1));
  if (!proposals.length) {
    throw new Error(
      "CSV headers must include a product/description or quantity column. Supported fields include SKU, product, quantity, unit, batch, expiry, and category.",
    );
  }
  return {
    proposals,
    warnings: proposals.some((proposal) => proposal.issues.length > 0)
      ? ["Check each highlighted field before confirming an inventory change."]
      : [],
  };
}

function cellField(label: string): CanonicalField | undefined {
  const normalized = normalizedHeader(label);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    CanonicalField,
    string[],
  ][]) {
    if (aliases.includes(normalized)) return field;
  }
  return undefined;
}

function parseLabeledLine(line: string): Record<CanonicalField, string> | null {
  const segments = line.split(/\s+\|\s+|\s*;\s*/);
  const fields = emptyFields();
  let found = false;
  for (const segment of segments) {
    const match = /^\s*([^:=]+)\s*[:=]\s*(.*?)\s*$/.exec(segment);
    if (!match) continue;
    const field = cellField(match[1]!);
    if (!field) continue;
    fields[field] = match[2]!.trim();
    found = true;
  }
  return found && fields.productName ? fields : null;
}

function rowsFromPdfItems(items: Array<{ str: string; x: number; y: number; width: number }>): string[] {
  const lines: Array<{ y: number; items: typeof items }> = [];
  for (const item of items) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const ordered = line.items.sort((a, b) => a.x - b.x);
      let output = "";
      let previous: (typeof ordered)[number] | undefined;
      for (const item of ordered) {
        const gap = previous ? item.x - (previous.x + previous.width) : 0;
        output += `${previous ? gap > 18 ? "\t" : " " : ""}${item.str}`;
        previous = item;
      }
      return output.trim();
    })
    .filter(Boolean);
}

function rowsFromDelimitedText(lines: string[]): InvoiceProposal[] {
  for (let headerIndex = 0; headerIndex < lines.length; headerIndex += 1) {
    const header = lines[headerIndex]!;
    const delimiter = header.includes("\t") ? "\t" : header.includes("|") ? "|" : "";
    if (!delimiter) continue;
    const headers = header.split(delimiter).map((cell) => cell.trim());
    const mapped = headerMap(headers);
    if (
      ![...mapped.values()].includes("productName") &&
      ![...mapped.values()].includes("quantity")
    ) continue;

    const rows = lines.slice(headerIndex + 1)
      .filter((line) => line.includes(delimiter))
      .map((line) => line.split(delimiter).map((cell) => cell.trim()));
    const proposals = proposalsFromRows(headers, rows);
    if (proposals.length) return proposals;
  }
  return [];
}

function rowsFromLabeledText(lines: string[]): InvoiceProposal[] {
  return lines
    .map(parseLabeledLine)
    .filter((fields): fields is Record<CanonicalField, string> => fields !== null)
    .map(buildProposal);
}

async function parsePdfInvoice(bytes: Uint8Array): Promise<InvoiceExtractionResult> {
  let textLines: string[] = [];
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > 50) {
      throw new Error("The PDF has too many pages.");
    }
    const allItems: Array<{ str: string; x: number; y: number; width: number }> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        allItems.push({
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width,
        });
        if (allItems.length > 100_000) {
          throw new Error("The PDF contains too much text to process.");
        }
      }
    }
    textLines = rowsFromPdfItems(allItems);
  } catch {
    throw new Error("This PDF could not be read. Upload a valid, text-based PDF or a supported CSV.");
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }

  if (!textLines.length) {
    return {
      proposals: [],
      warnings: ["No selectable text was found. Scanned/image-only PDFs are not supported; upload a text-based PDF or CSV."],
    };
  }

  const proposals = rowsFromDelimitedText(textLines);
  const labeled = proposals.length ? proposals : rowsFromLabeledText(textLines);
  if (!labeled.length) {
    return {
      proposals: [],
      warnings: ["No supported line-item table or labeled product rows were recognized. Scanned/image-only PDFs are not supported."],
    };
  }
  return {
    proposals: labeled,
    warnings: labeled.some((proposal) => proposal.issues.length > 0)
      ? ["Check each highlighted field before confirming an inventory change."]
      : [],
  };
}

export async function extractInvoice(
  bytes: Uint8Array,
  mimeType: "application/pdf" | "text/csv",
): Promise<InvoiceExtractionResult> {
  return mimeType === "text/csv"
    ? parseCsvInvoice(bytes)
    : parsePdfInvoice(bytes);
}

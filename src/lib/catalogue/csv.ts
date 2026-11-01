// Reads a catalogue CSV: one row per product with the columns sku, product, audience and image, and the optional columns shop and fact. Plain parsing
// with quoted fields, commas inside quotes, Windows line ends and a leading byte order mark. No library.
export const MAX_PRODUCTS = 12;
export const REQUIRED_COLUMNS = ["sku", "product", "audience", "image"] as const;

export interface CatalogueRow {
  sku: string;
  product: string; // what the product is, as a short plain name
  audience: string;
  image: string; // the photo's file name
  shop: string; // optional: the shop the ad is for, empty when the column is absent
  fact: string; // optional: one plain true line about the product, empty when the column is absent
}

export interface CatalogueRead {
  rows: CatalogueRow[];
  error: string | null; // a plain sentence when the file cannot be used; then rows is empty
}

/** Splits CSV text into rows of cells. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Turns CSV text into catalogue rows, or says in plain words why it cannot. Refuses more than MAX_PRODUCTS rows. */
export function readCatalogue(text: string): CatalogueRead {
  const fail = (error: string): CatalogueRead => ({ rows: [], error });
  const table = parseCsv(text);
  if (table.length === 0) return fail("The file is empty.");
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return fail(`The first row must name these columns: ${REQUIRED_COLUMNS.join(", ")}. Missing: ${missing.join(", ")}.`);
  const at = (name: string) => header.indexOf(name);
  const rows: CatalogueRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const row: CatalogueRow = {
      sku: (cells[at("sku")] ?? "").trim(),
      product: (cells[at("product")] ?? "").trim(),
      audience: (cells[at("audience")] ?? "").trim(),
      image: (cells[at("image")] ?? "").trim(),
      shop: at("shop") >= 0 ? (cells[at("shop")] ?? "").trim() : "",
      fact: at("fact") >= 0 ? (cells[at("fact")] ?? "").trim() : "",
    };
    if (!row.sku || !row.image) return fail(`Row ${i + 1} needs a sku and an image file name.`);
    rows.push(row);
  }
  if (rows.length === 0) return fail("The file has a header but no products.");
  if (rows.length > MAX_PRODUCTS) {
    return fail(`This catalogue has ${rows.length} products. The limit is ${MAX_PRODUCTS}, so nothing was loaded. Remove some rows and try again.`);
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.sku)) return fail(`Two rows use the sku "${r.sku}". Each sku must be different.`);
    seen.add(r.sku);
  }
  return { rows, error: null };
}

/** One CSV line from cells, quoting where needed. */
export function csvLine(cells: Array<string | number>): string {
  return cells.map((c) => { const s = String(c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",");
}

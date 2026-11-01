// The ZIP for "Download approved ads": each approved final as a JPEG named by its sku, plus results.csv.
// Pure apart from fflate, so the unit test can open the ZIP it makes.
import { zipSync, strToU8 } from "fflate";
import { exportRows, resultsCsv, type CatalogueItem } from "./model.js";

export interface ApprovedZip {
  bytes: Uint8Array;
  count: number;
}

/** Null when nothing is approved, so the page can say so instead of saving an empty file. */
export function buildApprovedZip(items: readonly CatalogueItem[]): ApprovedZip | null {
  const rows = exportRows(items);
  if (rows.length === 0) return null;
  const files: Record<string, Uint8Array> = { "results.csv": strToU8(resultsCsv(rows)) };
  for (const r of rows) files[r.fileName] = Uint8Array.from(atob(r.imageB64), (ch) => ch.charCodeAt(0));
  return { bytes: zipSync(files, { level: 0 }), count: rows.length };
}

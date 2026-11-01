// Is the cut-out the product, the whole product? SAM sometimes keeps half a pot and loses the plant, or returns a
// mask in loose pieces, or one that is sliced off at the photo's edge. Such a cut-out must not be laid out as if it
// were fine, so this check runs right after it is made and before any layout is drawn. Pure image counting, no
// model call, on a small grid so it is fast.
//
// Three failures:
//   small   far less of the product than the photo shows: the cut-out covers under 55 percent of what differs
//           from the photo's plain background (only judged when the background is plain enough to tell)
//   pieces  more than one sizeable separate piece
//   edge    the cut-out runs along the photo's edge, so the product is cut off by the frame
import sharp from "sharp";

export type SanityFailure = "small" | "pieces" | "edge";

export interface SanityVerdict {
  ok: boolean;
  failure: SanityFailure | null;
  reason: string | null; // plain words, set when it failed
  coverage: number | null; // share of the photo's foreground the cut-out covers; null when the background was not plain enough to judge
  pieces: number; // sizeable separate pieces in the cut-out
}

/** What the person is told when the cut-out is not used. */
export const PANEL_NOTE = "The product could not be cut out cleanly, so the original photo is shown.";

const GRID = 160; // long side of the comparison grid
const MIN_COVERAGE = 0.55;
const PIECE_SHARE = 0.04; // a piece counts when it is at least this share of the cut-out
const EDGE_RUN = 0.12; // the cut-out is cropped when this share of a photo edge is solid
const BORDER_NOISE = 22; // the photo's background counts as plain when its border varies by less than this (0 to 255)
const FOREGROUND_DISTANCE = 50; // colour distance from the background that counts as "not background"
const MIN_FOREGROUND = 0.02;
const MAX_FOREGROUND = 0.85;

interface Grid {
  w: number;
  h: number;
}

const gridFor = (width: number, height: number): Grid => {
  const k = GRID / Math.max(width, height);
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
};

/** Sizes of the 8-connected solid components of a 0/1 grid. */
export function componentSizes(mask: Uint8Array, w: number, h: number): number[] {
  const seen = new Uint8Array(w * h);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let size = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

/** The cut-out's solid pixels, placed where it sat in the photo, on the comparison grid. */
async function cutoutGrid(cutoutPng: Buffer, box: { left: number; top: number; width: number; height: number }, photo: { width: number; height: number }, g: Grid): Promise<Uint8Array> {
  const out = new Uint8Array(g.w * g.h);
  const kx = g.w / photo.width;
  const ky = g.h / photo.height;
  const cw = Math.max(1, Math.round(box.width * kx));
  const ch = Math.max(1, Math.round(box.height * ky));
  const { data, info } = await sharp(cutoutPng).ensureAlpha().resize({ width: cw, height: ch, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const left = Math.round(box.left * kx);
  const top = Math.round(box.top * ky);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const gx = left + x;
      const gy = top + y;
      if (gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
      if (data[(y * info.width + x) * info.channels + 3] > 128) out[gy * g.w + gx] = 1;
    }
  }
  return out;
}

/** What differs from the photo's plain background, or null when the background is not plain enough to tell. */
async function foregroundGrid(photoPng: Buffer, g: Grid): Promise<Uint8Array | null> {
  const { data, info } = await sharp(photoPng).flatten({ background: "#ffffff" }).resize({ width: g.w, height: g.h, fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const ring: number[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (x < 2 || y < 2 || x >= g.w - 2 || y >= g.h - 2) ring.push(y * g.w + x);
  const median = [0, 1, 2].map((c) => {
    const v = ring.map((p) => data[p * ch + c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  const dist = (p: number) => Math.hypot(data[p * ch] - median[0], data[p * ch + 1] - median[1], data[p * ch + 2] - median[2]);
  if (ring.reduce((a, p) => a + dist(p), 0) / ring.length > BORDER_NOISE) return null;
  const raw = new Uint8Array(g.w * g.h);
  for (let p = 0; p < raw.length; p++) raw[p] = dist(p) > FOREGROUND_DISTANCE ? 1 : 0;
  // Specks are noise, not product: keep only components of at least 1 percent of the grid.
  const keep = new Uint8Array(g.w * g.h);
  const seen = new Uint8Array(g.w * g.h);
  for (let s = 0; s < raw.length; s++) {
    if (!raw[s] || seen[s]) continue;
    const members = [s];
    seen[s] = 1;
    for (let k = 0; k < members.length; k++) {
      const p = members[k];
      const x = p % g.w;
      const y = (p - x) / g.w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const n = ny * g.w + nx;
        if (raw[n] && !seen[n]) { seen[n] = 1; members.push(n); }
      }
    }
    if (members.length >= 0.01 * g.w * g.h) for (const p of members) keep[p] = 1;
  }
  const share = keep.reduce((a, v) => a + v, 0) / keep.length;
  return share >= MIN_FOREGROUND && share <= MAX_FOREGROUND ? keep : null;
}

const dilate = (m: Uint8Array, w: number, h: number, r: number): Uint8Array => {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
    }
  }
  return out;
};

export interface SanityInput {
  cutoutPng: Buffer;
  box: { left: number; top: number; width: number; height: number }; // where the cut-out sat in the photo, in the photo's pixels
  photoPng: Buffer; // the photo the cut-out was made from
}

export async function cutoutSanity(input: SanityInput): Promise<SanityVerdict> {
  const meta = await sharp(input.photoPng).metadata();
  const photo = { width: meta.width ?? 1, height: meta.height ?? 1 };
  const g = gridFor(photo.width, photo.height);
  const cut = await cutoutGrid(input.cutoutPng, input.box, photo, g);
  const solid = cut.reduce((a, v) => a + v, 0);
  const fail = (failure: SanityFailure, reason: string, coverage: number | null, pieces: number): SanityVerdict => ({ ok: false, failure, reason, coverage, pieces });
  if (solid === 0) return fail("small", "the cut-out is empty", 0, 0);

  const sizes = componentSizes(cut, g.w, g.h);
  const pieces = sizes.filter((s) => s >= PIECE_SHARE * solid).length;
  if (pieces > 1) return fail("pieces", `the cut-out is in ${pieces} separate pieces`, null, pieces);

  // Cropped: a long solid run along any edge of the photo.
  const run = (cells: number[]) => cells.reduce((a, p) => a + cut[p], 0);
  const edges = [
    Array.from({ length: g.w }, (_, x) => x),
    Array.from({ length: g.w }, (_, x) => (g.h - 1) * g.w + x),
    Array.from({ length: g.h }, (_, y) => y * g.w),
    Array.from({ length: g.h }, (_, y) => y * g.w + g.w - 1),
  ];
  if (edges.some((e) => run(e) >= Math.max(3, EDGE_RUN * e.length))) return fail("edge", "the cut-out is cut off at the edge of the photo", null, pieces);

  const fg = await foregroundGrid(input.photoPng, g);
  if (fg) {
    const wide = dilate(cut, g.w, g.h, 2);
    let total = 0;
    let covered = 0;
    for (let p = 0; p < fg.length; p++) if (fg[p]) { total++; if (wide[p]) covered++; }
    const coverage = covered / total;
    if (coverage < MIN_COVERAGE) return fail("small", `the cut-out covers only ${Math.round(coverage * 100)} percent of the product in the photo`, coverage, pieces);
    return { ok: true, failure: null, reason: null, coverage, pieces };
  }
  return { ok: true, failure: null, reason: null, coverage: null, pieces };
}

/**
 * The whole original photo as a rounded panel on a transparent background, in the shape of a cut-out, so the studio
 * layout can set it on a plain palette background when the real cut-out cannot be used.
 */
export async function photoAsPanel(photoPng: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const flat = await sharp(photoPng).flatten({ background: "#ffffff" }).resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const { width = 1, height = 1 } = await sharp(flat).metadata();
  const r = Math.round(Math.min(width, height) * 0.04);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  const png = await sharp(flat).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return { png, width, height };
}

/** What the person is told when a cut-out lost a part of the product and the whole photo is used instead. */
export const partialNote = (missing: string): string => `The cut-out lost part of the product (${missing}), so the whole photo is used instead.`;

/** The question for a model that looks at the photo and at its cut-out: is all of the product still there? */
export const COMPLETE_PROMPT =
  "The first picture is a product photo. The second picture is a cut-out of the product on white. " +
  "Is the whole product in the cut-out? Answer complete false only when a clearly visible, significant part of the product itself is gone from the cut-out " +
  "(for example a plant without its pot, a mug without its handle, a lamp without its shade, a bottle without its lid). " +
  "Ignore small edge differences, shadows, the table or the background. " +
  'Reply only as JSON: {"complete":true,"missing":""} where missing is a short phrase naming what is gone, such as "the pot".';

/** The verdict from the model. Anything unreadable counts as complete, so the check can never block a good cut-out on its own failure. */
export function parseComplete(raw: unknown): { complete: boolean; missing: string } {
  const j = (raw ?? {}) as { complete?: unknown; missing?: unknown };
  if (j.complete !== false) return { complete: true, missing: "" };
  const missing = typeof j.missing === "string" ? j.missing.replace(/[^\w\s'-]/g, "").trim().slice(0, 40) : "";
  return { complete: false, missing: missing || "part of it" };
}

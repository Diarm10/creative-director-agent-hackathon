// NEW FOR HACKATHON. The layout engine: takes copy, a palette and optional artwork or a product
// cut-out, and draws a finished graphic with real typography. Muse Image never draws text; it only
// supplies artwork (the artwork-led layout) and the product photo path stays the real product.
//
// Three archetypes, chosen per brief:
//   typographic  huge condensed headline, procedural pattern, small badge. Three variants
//                (stack, anchor, block) so posters do not all share one composition.
//   artwork      one strong image, type straight onto a calm area of it
//   product      the real product large on one clean palette background, one scene, no seams
//   behind       a huge headline set behind the real product, which overlaps it, on a bold colour field
//
// The call to action is always its own element: a filled pill, never text run on after the subline.
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { PATTERN_KINDS, patternSvg, rng, type Band, type PatternKind } from "./patterns.js";
import { finishImage } from "./finish.js";
import { contrast, legibleAccent, luminance, makePalette, mix, textOn, type Palette } from "./palette.js";
import { applyBackgroundEffect, stickerBorder, type Rect, effectColours, effectGround, outlineMask, outlineRadius, productOutlineLayer, stylisedProduct, type EffectSpec } from "./effects.js";
import { fitHeadline, fitLine, measure100, renderTextLayer, type FontKey, type TextBlock } from "./typeset.js";

export type Archetype = "typographic" | "artwork" | "product" | "behind";
export const ARCHETYPES: readonly Archetype[] = ["typographic", "artwork", "product", "behind"];
export type Variant = "stack" | "anchor" | "block";
export const VARIANTS: readonly Variant[] = ["stack", "anchor", "block"];

/** Thrown when an artwork has no calm area for type and must not be cropped or smeared to make one. */
export const NO_CALM_SPACE = "NO_CALM_SPACE";

export interface DesignSpec {
  archetype: Archetype;
  width: number;
  height: number;
  palette?: Palette;
  brandColours?: readonly string[];
  headline: string;
  subline?: string;
  organiser?: string; // small label, for example the client or organiser name
  details?: string[]; // key details such as a date and a place, at most two are drawn
  cta?: string; // the call to action, drawn as a pill
  badge?: string[]; // one or two short lines for the small round badge (typographic only)
  artwork?: Buffer; // for the artwork archetype
  keepWhole?: boolean; // the picture holds a subject that must never be cropped or smeared (a real product scene)
  product?: Buffer; // transparent cut-out for the product archetype
  seed?: number;
  pattern?: PatternKind;
  variant?: Variant;
  ctaScale?: number; // 1 is the default size of the call to action pill; a revision can make it larger or smaller
  gapScale?: number; // 1 is the default spacing: the margin between type and product, and the lines inside the type block
  productBox?: { left: number; top: number; width: number; height: number }; // where the product sits in the scene, in the scene's own pixels
  onLayout?: (metrics: LayoutMetrics) => void; // told how the design was composed, for tests and reports
  productScale?: number; // 1 is the default size of the product in the studio and type-behind layouts; a revision can make it larger or smaller
  headScale?: number; // 1 is the default headline size in those layouts; a revision can make it smaller
  fitStep?: number; // internal: how far the studio layout has already gone down FIT_STEPS to keep the product big enough
  masthead?: boolean; // type behind the product as a magazine masthead: the headline is one huge line, with a rule above it
  sticker?: boolean; // studio layout: one flat colour and a thick white sticker border round the product
  photoPanel?: boolean; // studio layout: the product is the whole original photo, which is drawn as large as the ad allows
  effectMuted?: boolean; // Pop Art on a neutral product: the restrained version
  effect?: EffectSpec; // an effect for the background and the graphic layers; the product keeps its true colour unless effect.stylise
  callouts?: string[]; // studio layout: two or three short callouts under the product (Spec Sheet), taken only from the fact column
  overlapGuard?: number; // type behind the product: 0 is the normal guard, each step above it asks for more of the last line to stay visible
  finish?: number; // strength of the finishing pass, 0 to 1; 0 turns it off, and unset uses the default in finish.ts
}

const clampScale = (v: number | undefined, lo: number, hi: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 1);
const ctaK = (spec: DesignSpec) => clampScale(spec.ctaScale, 0.8, 1.5);
const gapK = (spec: DesignSpec) => clampScale(spec.gapScale, 0.35, 2.2);
const productK = (spec: DesignSpec) => clampScale(spec.productScale, 0.6, 1.3);
/** When the product would come out under 45 percent of the frame height, the headline gives way: one line first, then smaller, down to a floor. */
const FIT_STEPS: ReadonlyArray<{ lines: number; k: number }> = [{ lines: 2, k: 1 }, { lines: 1, k: 1 }, { lines: 2, k: 0.9 }, { lines: 1, k: 0.9 }, { lines: 2, k: 0.8 }, { lines: 2, k: 0.7 }, { lines: 2, k: 0.6 }];
export const MIN_PRODUCT_SHARE = 0.45; // of the frame height
export const MIN_HEADLINE_GAP = 0.034; // of the frame height: the product starts at least this far below the last headline line
const headK = (spec: DesignSpec) => clampScale(spec.headScale, 0.6, 1);

const rasterSvg = (svg: string, width: number): Buffer => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
const svgWrap = (W: number, H: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;

const clean = (s: string | undefined, max: number): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Boxes round the text blocks (with a safe gap), for effects that must not run under type. The call to action has its own fill, so it is skipped. */
function textRects(blocks: readonly TextBlock[], W: number, u: number, skipText: string): Rect[] {
  const gap = 10 * u;
  return blocks
    .filter((b) => b.text !== skipText)
    .map((b) => ({ left: Math.max(0, b.x - gap), top: Math.max(0, b.y - gap / 2), width: Math.min(W - Math.max(0, b.x - gap), b.width + 2 * gap), height: b.size * (b.lineHeight ?? 1) * 1.25 + gap }));
}

/** Mean luminance of the opaque pixels of a cut-out, 0 (black) to 1 (white). */
export async function productLuminance(cutout: Buffer): Promise<number> {
  const { data, info } = await sharp(cutout).resize(24, 24, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (info.channels === 4 && data[i + 3] < 200) continue;
    sum += luminance(`#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    n++;
  }
  return n ? sum / n : 0.5;
}

/** A solid rectangle just behind a line of text, so pattern lines stop at the text instead of crossing it. */
async function quietTag(text: string, x: number, y: number, size: number, font: FontKey, upper: boolean, ls: number, fill: string, pad: number): Promise<string> {
  const w = ((await measure100(text, font, upper, ls / size)) * size) / 100 + ls * text.length;
  return `<rect x="${(x - pad).toFixed(1)}" y="${(y - pad * 0.6).toFixed(1)}" width="${(w + pad * 2).toFixed(1)}" height="${(size * 1.25 + pad * 1.2).toFixed(1)}" fill="${fill}"/>`;
}

interface Frame {
  W: number;
  H: number;
  u: number; // scale unit, 1 at 1080px wide
  m: number; // outer margin
  top: number; // top inset (stories keep clear of the app UI)
  bottom: number;
  tall: boolean;
  k: number; // type scale for tall formats, which have more room
}

function frame(W: number, H: number): Frame {
  const u = W / 1080;
  const tall = H / W > 1.4;
  return { W, H, u, m: Math.round(72 * u), top: Math.round((H / W > 1.6 ? 150 : 72) * u), bottom: Math.round((H / W > 1.6 ? 150 : 72) * u), tall, k: tall ? 1.3 : 1 };
}

/**
 * The call to action as a deliberate element: a filled pill with its own text, sized to read on a
 * phone, and always separate from the subline. Shrinks only if the words cannot fit the width.
 */
async function ctaPill(text: string, x: number, y: number, maxW: number, size: number, fill: string, ink: string) {
  let s = size;
  let textW = ((await measure100(text, "body-bold", false, 0)) * s) / 100;
  const padFor = (sz: number) => sz * 0.9;
  if (textW + 2 * padFor(s) > maxW) {
    s = Math.max(18, Math.floor((s * (maxW - 2 * padFor(s))) / textW));
    textW = ((await measure100(text, "body-bold", false, 0)) * s) / 100;
  }
  const pad = padFor(s);
  const h = s * 1.95;
  const w = textW * 1.02 + 2 * pad;
  const shape = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="${fill}"/>`;
  const block: TextBlock = { text, x: x + pad, y: y + h / 2 - s / 2, width: textW + pad, size: s, font: "body-bold", color: ink, lineHeight: 1 };
  return { shape, block, w, h };
}

/**
 * The colour for the last line of a headline on a dark ground: the first brand accent that is big-type
 * legible (3:1), so the poster carries its colour in the type. Null when no accent is bright enough.
 */
function emphasisColour(p: Palette): string | undefined {
  return [p.accents[0], p.accents[1]].find((c) => c !== p.light && contrast(c, p.dark) >= 3);
}

/** Stacks fitted headline lines as text blocks. Returns blocks and the y just below them. */
async function headlineBlocks(
  text: string, x: number, y: number, maxW: number, maxH: number, maxLines: number, maxSize: number, color: string, justify = false, lastLine?: string,
): Promise<{ blocks: TextBlock[]; bottom: number; size: number }> {
  const lh = 0.92;
  const fit = await fitHeadline({ text, maxWidth: maxW, maxHeight: maxH, maxLines, lineHeight: lh, maxSize });
  const lineSizes =
    justify && fit.lines.length > 1
      ? (await Promise.all(fit.lines.map((l) => measure100(l, "display", true, 0.01)))).map((w) => (100 * maxW) / w)
      : [];
  // Justified only when the sizes stay close; wildly different line sizes read as a mistake.
  if (justify && fit.lines.length > 1 && Math.max(...lineSizes) / Math.min(...lineSizes) <= 1.7) {
    // Each line is sized to fill the full width, the way stacked poster type is set, then the
    // whole stack is scaled down if it would not fit the height.
    let sizes = lineSizes.map((v) => Math.min(maxSize, v));
    const total = sizes.reduce((a, b) => a + b * lh, 0);
    if (total > maxH) sizes = sizes.map((v) => (v * maxH) / total);
    let cy = y;
    const blocks = fit.lines.map<TextBlock>((line, i) => {
      const size = Math.floor(sizes[i]);
      const b: TextBlock = { text: line, x, y: cy, width: maxW, size, font: "display", color: lastLine && i === fit.lines.length - 1 ? lastLine : color, lineHeight: lh, letterSpacing: size * 0.01, uppercase: true };
      cy += size * lh;
      return b;
    });
    return { blocks, bottom: cy, size: Math.min(...sizes.map(Math.floor)) };
  }
  const blocks = fit.lines.map<TextBlock>((line, i) => ({
    text: line, x, y: y + i * fit.size * lh, width: maxW, size: fit.size, font: "display", color: lastLine && i === fit.lines.length - 1 && fit.lines.length > 1 ? lastLine : color,
    lineHeight: lh, letterSpacing: fit.size * 0.01, uppercase: true,
  }));
  return { blocks, bottom: y + fit.lines.length * fit.size * lh, size: fit.size };
}

interface Rows {
  fits: { lines: string[] }[];
  size: number;
  heights: number[];
  total: number;
}

/** Key detail rows (date, place, offer): a long one wraps onto two lines and stays big. */
async function fitRows(details: string[], width: number, maxSize: number, u: number): Promise<Rows> {
  const fits = await Promise.all(
    details.map((d) => fitHeadline({ text: d, maxWidth: width, maxHeight: maxSize * 2.1, maxLines: 2, lineHeight: 1, maxSize, font: "display-semi", uppercase: true, letterSpacingEm: 0.02 })),
  );
  const size = fits.length ? Math.min(...fits.map((x) => x.size)) : maxSize;
  const heights = fits.map((x) => x.lines.length * size * 1.05 + 30 * u);
  return { fits, size, heights, total: heights.reduce((a, b) => a + b, 0) };
}

/** Draws the rows with a hairline above each. Returns the y just below the last row. */
function placeRows(rows: Rows, x: number, y: number, width: number, rule: string, ink: string, u: number, blocks: TextBlock[], shapes: string[]): number {
  let ry = y;
  rows.fits.forEach((fit, i) => {
    shapes.push(`<rect x="${x}" y="${ry}" width="${width}" height="${2 * u}" fill="${rule}"/>`);
    fit.lines.forEach((line, li) =>
      blocks.push({ text: line, x, y: ry + 14 * u + li * rows.size * 1.05, width, size: rows.size, font: "display-semi", color: ink, letterSpacing: rows.size * 0.02, uppercase: true }),
    );
    ry += rows.heights[i];
  });
  return ry;
}

/** The small round badge. Text is fitted to the circle. */
async function placeBadge(lines: string[], cx: number, cy: number, r: number, p: Palette, u: number, blocks: TextBlock[], shapes: string[]) {
  shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.light}"/>`);
  const inner = r * 1.5;
  let size = r * 0.5;
  for (const l of lines) size = Math.min(size, await fitLine(l, inner, r * 0.5, "display", true));
  const total = lines.length * size;
  lines.forEach((l, i) =>
    blocks.push({ text: l, x: cx - inner / 2, y: cy - total / 2 + i * size, width: inner, size, font: "display", color: p.dark, align: "center", lineHeight: 1, uppercase: true }),
  );
  shapes.push(`<line x1="${cx - inner / 2}" y1="${cy + total / 2 + 8 * u}" x2="${cx + inner / 2}" y2="${cy + total / 2 + 8 * u}" stroke="${p.dark}" stroke-width="${3 * u}"/>`);
}

interface Parts {
  label: string;
  sub: string;
  cta: string;
  details: string[];
  badgeLines: string[];
}

function parts(spec: DesignSpec): Parts {
  return {
    label: clean(spec.organiser, 40),
    sub: clean(spec.subline, 70),
    cta: clean(spec.cta, 64),
    details: (spec.details ?? []).map((d) => clean(d, 70)).filter(Boolean).slice(0, 2),
    badgeLines: (spec.badge ?? []).map((b) => clean(b, 18)).filter(Boolean).slice(0, 2),
  };
}

interface TypoResult {
  blocks: TextBlock[];
  shapes: string[];
  quiet: string[];
  bands: Band[];
}

/** Classic poster: label, big stacked headline, subline, then ruled detail rows and a pill at the foot. */
async function variantStack(spec: DesignSpec, p: Palette, f: Frame, kind: PatternKind): Promise<TypoResult> {
  const { W, H, u, m, k } = f;
  const { label, sub, cta, details, badgeLines } = parts(spec);
  const fg = p.light;
  const blocks: TextBlock[] = [];
  const shapes: string[] = [];
  const quiet: string[] = [];

  if (label) {
    blocks.push({ text: label, x: m, y: f.top, width: W - 2 * m, size: 24 * u * k, font: "body-bold", color: legibleAccent(p.dark, p), letterSpacing: 24 * u * k * 0.2, uppercase: true });
    quiet.push(await quietTag(label, m, f.top, 24 * u * k, "body-bold", true, 24 * u * k * 0.2, p.dark, 16 * u));
  }
  const badgeR = badgeLines.length ? Math.round(W * 0.115) : 0;
  const rightLimit = W - 2 * m - (badgeR ? badgeR * 2 + 30 * u : 0);

  const rows = await fitRows(details, rightLimit, 58 * u * k, u);
  const pillSize = 38 * u * tallScale(f) * ctaK(spec);
  const pillH = cta ? pillSize * 1.95 : 0;
  const footerH = rows.total + (cta ? pillH + 28 * u : 0);
  const footerTop = H - f.bottom - footerH;

  const headTop = f.top + (label ? 70 * u * k : 0);
  const subSpace = sub ? 70 * u : 0;
  const headMaxH = Math.max(120 * u, footerTop - headTop - subSpace - 40 * u);
  const head = await headlineBlocks(clean(spec.headline, 60), m, headTop, W - 2 * m, headMaxH, 3, (f.tall ? 560 : 460) * u, fg, true, emphasisColour(p));
  blocks.push(...head.blocks);

  // Spare vertical room is shared: the headline group drops a little, so there is no dead gap
  // under the subline and the poster does not read top-heavy.
  const subSize = sub ? await fitLine(sub, W - 2 * m, 36 * u * k, "body") : 0;
  const groupBottom = head.bottom + (sub ? 22 * u + subSize * 1.3 + 16 * u : 0);
  const spare = footerTop - 30 * u - groupBottom;
  const drop = spare > 100 * u ? spare * 0.35 : 0;
  head.blocks.forEach((b) => (b.y += drop));
  let belowHead = head.bottom + drop;
  if (sub) {
    const sy = head.bottom + drop + 22 * u;
    blocks.push({ text: sub, x: m, y: sy, width: W - 2 * m, size: subSize, font: "body", color: mix(p.dark, p.light, 0.72), lineHeight: 1.2 });
    quiet.push(await quietTag(sub, m, sy, subSize, "body", false, 0, p.dark, 16 * u));
    belowHead = sy + subSize * 1.3 + 16 * u;
  }
  // Only the busy diagonal hatch needs a clean footer; the other patterns are quiet enough to run behind it.
  if ((details.length || cta) && kind === "diagonals") quiet.push(`<rect x="0" y="${(footerTop - 26 * u).toFixed(1)}" width="${W}" height="${H}" fill="${p.dark}"/>`);

  const rowEnd = placeRows(rows, m, footerTop, rightLimit, mix(p.dark, p.light, 0.35), fg, u, blocks, shapes);
  if (cta) {
    const fill = legibleAccent(p.dark, p);
    const pill = await ctaPill(cta, m, rowEnd + 12 * u, rightLimit, pillSize, fill, textOn(fill, p));
    shapes.push(pill.shape);
    blocks.push(pill.block);
  }
  if (badgeR) await placeBadge(badgeLines, W - m - badgeR, H - f.bottom - badgeR, badgeR, p, u, blocks, shapes);

  const bands: Band[] = [];
  if (headTop + drop - 12 * u > 40 * u) bands.push({ y0: 0, y1: headTop + drop - 12 * u });
  if (footerTop - 30 * u - belowHead > 60 * u) bands.push({ y0: belowHead, y1: footerTop - 30 * u });
  return { blocks, shapes, quiet, bands };
}

const tallScale = (f: Frame) => (f.tall ? 1.15 : 1);

/** Details sit at the top under the label, the headline is anchored at the foot, the pattern fills the middle. */
async function variantAnchor(spec: DesignSpec, p: Palette, f: Frame): Promise<TypoResult> {
  const { W, H, u, m, k } = f;
  const { label, sub, cta, details, badgeLines } = parts(spec);
  const fg = p.light;
  const blocks: TextBlock[] = [];
  const shapes: string[] = [];
  const quiet: string[] = [];

  if (label) {
    blocks.push({ text: label, x: m, y: f.top, width: W - 2 * m, size: 24 * u * k, font: "body-bold", color: legibleAccent(p.dark, p), letterSpacing: 24 * u * k * 0.2, uppercase: true });
    quiet.push(await quietTag(label, m, f.top, 24 * u * k, "body-bold", true, 24 * u * k * 0.2, p.dark, 16 * u));
  }
  const badgeR = badgeLines.length ? Math.round(W * 0.105) : 0;
  const rowWidth = W - 2 * m - (badgeR ? badgeR * 2 + 30 * u : 0);
  const rows = await fitRows(details, rowWidth, 52 * u * k, u);
  const rowsTop = f.top + (label ? 80 * u * k : 0);
  const rowsEnd = placeRows(rows, m, rowsTop, rowWidth, mix(p.dark, p.light, 0.35), fg, u, blocks, shapes);
  if (badgeR) await placeBadge(badgeLines, W - m - badgeR, f.top + badgeR + 30 * u, badgeR, p, u, blocks, shapes);

  // Bottom-up: pill, subline, headline.
  let cursor = H - f.bottom;
  if (cta) {
    const fill = legibleAccent(p.dark, p);
    const size = 38 * u * tallScale(f) * ctaK(spec);
    const pill = await ctaPill(cta, m, cursor - size * 1.95, W - 2 * m, size, fill, textOn(fill, p));
    shapes.push(pill.shape);
    blocks.push(pill.block);
    cursor -= size * 1.95 + 30 * u;
  }
  if (sub) {
    const size = await fitLine(sub, W - 2 * m, 36 * u * k, "body");
    const sy = cursor - size * 1.3;
    blocks.push({ text: sub, x: m, y: sy, width: W - 2 * m, size, font: "body", color: mix(p.dark, p.light, 0.72), lineHeight: 1.2 });
    quiet.push(await quietTag(sub, m, sy, size, "body", false, 0, p.dark, 16 * u));
    cursor = sy - 18 * u;
  }
  const maxH = Math.max(150 * u, cursor - (rowsEnd + 110 * u));
  const head = await headlineBlocks(clean(spec.headline, 60), m, 0, W - 2 * m, maxH, 3, (f.tall ? 560 : 440) * u, fg, true, emphasisColour(p));
  const shift = cursor - head.bottom;
  head.blocks.forEach((b) => (b.y += shift));
  blocks.push(...head.blocks);
  const headTop = shift;

  const bands: Band[] = [];
  if (headTop - 20 * u - (rowsEnd + 20 * u) > 70 * u) bands.push({ y0: rowsEnd + 20 * u, y1: headTop - 20 * u });
  return { blocks, shapes, quiet, bands };
}

/** The headline sits on a solid colour block across the lower half; label, details and pattern above. */
async function variantBlock(spec: DesignSpec, p: Palette, f: Frame): Promise<TypoResult> {
  const { W, H, u, m, k } = f;
  const { label, sub, cta, details, badgeLines } = parts(spec);
  const blocks: TextBlock[] = [];
  const shapes: string[] = [];
  const quiet: string[] = [];
  const blockCol = p.accents[0];
  const ink = textOn(blockCol, p);
  const blockTop = Math.round(H * (f.tall ? 0.46 : 0.42));
  shapes.push(`<rect x="0" y="${blockTop}" width="${W}" height="${H - blockTop}" fill="${blockCol}"/>`);

  if (label) {
    blocks.push({ text: label, x: m, y: f.top, width: W - 2 * m, size: 24 * u * k, font: "body-bold", color: legibleAccent(p.dark, p), letterSpacing: 24 * u * k * 0.2, uppercase: true });
    quiet.push(await quietTag(label, m, f.top, 24 * u * k, "body-bold", true, 24 * u * k * 0.2, p.dark, 16 * u));
  }
  const badgeR = badgeLines.length ? Math.round(W * 0.1) : 0;
  const rowWidth = W - 2 * m - (badgeR ? badgeR * 2 + 30 * u : 0);
  const rows = await fitRows(details, rowWidth, 50 * u * k, u);
  const rowsTop = f.top + (label ? 80 * u * k : 0);
  const rowsEnd = placeRows(rows, m, rowsTop, rowWidth, mix(p.dark, p.light, 0.35), p.light, u, blocks, shapes);
  if (badgeR) await placeBadge(badgeLines, W - m - badgeR, blockTop - badgeR - 24 * u, badgeR, p, u, blocks, shapes);

  // Inside the block: headline, subline, pill.
  const pad = 40 * u;
  let cursor = H - f.bottom;
  if (cta) {
    const size = 38 * u * tallScale(f) * ctaK(spec);
    const pill = await ctaPill(cta, m, cursor - size * 1.95, W - 2 * m, size, ink, blockCol);
    shapes.push(pill.shape);
    blocks.push(pill.block);
    cursor -= size * 1.95 + 28 * u;
  }
  let subSize = 0;
  if (sub) {
    subSize = await fitLine(sub, W - 2 * m, 36 * u * k, "body");
    const sy = cursor - subSize * 1.3;
    blocks.push({ text: sub, x: m, y: sy, width: W - 2 * m, size: subSize, font: "body", color: ink, lineHeight: 1.2 });
    cursor = sy - 14 * u;
  }
  const maxH = Math.max(120 * u, cursor - (blockTop + pad));
  const head = await headlineBlocks(clean(spec.headline, 60), m, 0, W - 2 * m, maxH, 3, (f.tall ? 560 : 440) * u, ink, true);
  head.blocks.forEach((b) => (b.y += blockTop + pad));
  blocks.push(...head.blocks);

  const bands: Band[] = [];
  if (blockTop - 20 * u - (rowsEnd + 20 * u) > 70 * u) bands.push({ y0: rowsEnd + 20 * u, y1: blockTop - 20 * u });
  return { blocks, shapes, quiet, bands };
}

async function typographic(spec: DesignSpec, p: Palette, f: Frame): Promise<Buffer> {
  const { W, H } = f;
  const seed = spec.seed ?? 7;
  const chosenKind = spec.pattern ?? PATTERN_KINDS[Math.floor(rng(seed + 11)() * PATTERN_KINDS.length)];
  const variant = spec.variant ?? VARIANTS[Math.floor(rng(seed + 3)() * VARIANTS.length)];
  // The bars pattern pokes small stubs up over the edge of the colour block, which reads as a mistake: use the grid there.
  const kind = variant === "block" && chosenKind === "bars" ? "grid" : chosenKind;
  const r = variant === "anchor" ? await variantAnchor(spec, p, f) : variant === "block" ? await variantBlock(spec, p, f) : await variantStack(spec, p, f, kind);

  // The bars pattern is quiet fills, so the text needs no clearing behind it.
  if (kind === "bars") r.quiet = [];
  const bands = kind === "grid" && r.bands.length > 1 ? [...r.bands].sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0)).slice(0, 1) : r.bands;
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: p.dark } })
    .composite([
      { input: rasterSvg(patternSvg(kind, W, H, p, true, seed, bands), W) },
      { input: rasterSvg(svgWrap(W, H, `${r.quiet.join("")}${r.shapes.join("")}`), W) },
    ])
    .png()
    .toBuffer();
  const finished = await finishImage(base, { palette: p, strength: spec.finish, seed });
  return sharp(finished).composite([{ input: await renderTextLayer(r.blocks, W, H) }]).png().toBuffer();
}

/**
 * How many pixels of calm image there are at the top and at the bottom. A row stops being calm when it varies
 * a lot (a product edge, a busy texture) or when its colour has moved away from the colour at the edge (a wall
 * turning into fabric: on a small copy a fine texture averages out and looks smooth, but its colour gives it
 * away). sharp's stats() ignores extract(), so this works on a downscaled raw copy instead.
 */
async function calmExtent(img: Buffer, H: number): Promise<{ top: number; bottom: number }> {
  const N = 64;
  const { data, info } = await sharp(img).resize(N, N, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const edge = Math.floor(N * 0.12); // the outer columns carry vignetting and edge shading, not a different surface
  const cols = N - 2 * edge;
  const row = (y: number) => {
    let r = 0, g = 0, b = 0, sum = 0, sq = 0;
    for (let x = edge; x < N - edge; x++) {
      const i = (y * N + x) * ch;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += l;
      sq += l * l;
    }
    const mean = sum / cols;
    return { r: r / cols, g: g / cols, b: b / cols, sd: Math.sqrt(Math.max(0, sq / cols - mean * mean)) };
  };
  const LIMIT = 16; // luminance spread that counts as busy
  const SHIFT = 60; // colour distance from the edge colour (sum of the three channels) that counts as a different surface
  const scan = (fromTop: boolean) => {
    const at = (i: number) => row(fromTop ? i : N - 1 - i);
    const ref = [at(0), at(1), at(2)].reduce((a, c) => ({ r: a.r + c.r / 3, g: a.g + c.g / 3, b: a.b + c.b / 3, sd: 0 }), { r: 0, g: 0, b: 0, sd: 0 });
    let n = 0;
    while (n < N) {
      const c = at(n);
      if (c.sd >= LIMIT || Math.abs(c.r - ref.r) + Math.abs(c.g - ref.g) + Math.abs(c.b - ref.b) > SHIFT) break;
      n++;
    }
    return Math.round((n / N) * H);
  };
  return { top: scan(true), bottom: scan(false) };
}

/** Average colour of a horizontal band of an image. */
async function bandColour(img: Buffer, W: number, top: number, height: number): Promise<string> {
  const band = await sharp(img).extract({ left: 0, top, width: W, height: Math.max(1, height) }).png().toBuffer();
  const { channels } = await sharp(band).stats();
  return `#${[channels[0].mean, channels[1].mean, channels[2].mean].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

// ---- Product scene: type and product as one group --------------------------------------------

export interface LayoutMetrics {
  mode: "grouped" | "calm-top" | "band" | "composite" | "behind";
  zoom: number; // how far the scene was enlarged around the product (1 is not at all)
  gapPx: number; // from the bottom of the type block to the top of the scene's content (the product and what it sits on)
  productGapPx: number; // from the bottom of the type block to the top of the product itself
  textTop: number;
  textBottom: number;
  productTop: number;
  productBottom: number;
  productLeft: number;
  productRight: number;
  headSize: number; // headline size in pixels
  keptLabel?: boolean; // whether the organiser label and the subline made it into the type block
  keptSubline?: boolean;
  panel?: { top: number; bottom: number }; // the header panel, when the scene's own surface was wide
  headlineVisible?: number[]; // type behind the product: the share of each headline line (0 to 1) the product leaves visible, measured on the real pixels
  headlineBounds?: { left: number; right: number; top: number; bottom: number }; // where the headline's ink really is, measured on the pixels, so a test can prove no text is clipped
  overlapSteps?: string[]; // what the overlap guard had to do to reach the limits, in plain words; empty when the first placement was fine
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Per-format composition: the margin between type and product, how far the scene may be enlarged, and the outer margins. */
export function groupParams(W: number, H: number, u: number, m: number, f: { top: number; bottom: number }) {
  const ratio = H / W;
  if (ratio > 1.6) return { format: "story" as const, G0: 64 * u, sMax: 1.35, topM: f.top, botM: f.bottom * 0.7 };
  if (ratio > 1.4) return { format: "poster" as const, G0: 52 * u, sMax: 1.45, topM: f.top, botM: m };
  return { format: "square" as const, G0: 44 * u, sMax: 1.55, topM: f.top, botM: m };
}

/** Maps the product box SAM found in the scene (in the scene's own pixels) onto the W x H canvas the scene is cover-fitted to. */
export function mapSceneBox(box: { left: number; top: number; width: number; height: number }, aw: number, ah: number, W: number, H: number): Box {
  const scale = Math.max(W / aw, H / ah);
  const offX = (aw * scale - W) / 2;
  const offY = (ah * scale - H) / 2;
  const clampX = (v: number) => Math.max(0, Math.min(W, v));
  const clampY = (v: number) => Math.max(0, Math.min(H, v));
  return {
    left: clampX(box.left * scale - offX),
    top: clampY(box.top * scale - offY),
    right: clampX((box.left + box.width) * scale - offX),
    bottom: clampY((box.top + box.height) * scale - offY),
  };
}

async function artwork(spec: DesignSpec, p: Palette, f: Frame): Promise<Buffer> {
  const { W, H, u, m } = f;
  if (!spec.artwork) throw new Error("artwork layout needs artwork");
  const tall = H / W > 1.6;
  const art = await sharp(spec.artwork).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();
  const pad = 34 * u;
  const all = parts(spec);
  const { cta, details } = all;

  // Lays the text out from y = 0 inside a zone of the given height and reports how tall it came out.
  // The organiser label and the subline are optional: they are dropped before the picture is given up on.
  const k = tall ? 1.35 : 1; // more room on tall formats, so the small type can be bigger
  const build = async (zoneH: number, bg: string, fg: string, quietFg: string, accent: string, keep = { label: true, sub: true }) => {
    const label = keep.label ? all.label : "";
    const sub = keep.sub ? all.sub : "";
    const blocks: TextBlock[] = [];
    const shapes: string[] = [];
    let y = 0;
    if (label) {
      blocks.push({ text: label, x: m, y, width: W - 2 * m, size: 22 * u * k, font: "body-bold", color: accent, letterSpacing: 22 * u * k * 0.2, uppercase: true });
      y += 44 * u * k;
    }
    const g = gapK(spec);
    const pillSize = 38 * u * (tall ? 1.15 : 1) * ctaK(spec);
    const footer = (details.length ? 40 * u * k : 0) + (cta ? pillSize * 1.95 + 20 * u * g : 0);
    const headMaxH = Math.max(40 * u, zoneH - y - footer - (sub ? 64 * u * k : 0) - 10 * u);
    const head = await headlineBlocks(clean(spec.headline, 60), m, y, W - 2 * m, headMaxH, 2, 240 * u, fg);
    blocks.push(...head.blocks);
    y = head.bottom;
    if (sub) {
      const size = await fitLine(sub, W - 2 * m, 32 * u * k, "body");
      blocks.push({ text: sub, x: m, y: y + 14 * u * g, width: W - 2 * m, size, font: "body", color: quietFg });
      y += 14 * u * g + size * 1.3;
    }
    let fy = y + 22 * u * g;
    if (details.length) {
      const dSize = await fitLine(details.join("   ·   "), W - 2 * m, 28 * u * k, "display-semi", true, 0.04);
      blocks.push({ text: details.join("   ·   "), x: m, y: fy, width: W - 2 * m, size: dSize, font: "display-semi", color: accent, letterSpacing: dSize * 0.04, uppercase: true });
      fy += 40 * u * k;
    }
    let contentH = details.length ? fy - 40 * u * k + 28 * u * k * 1.3 : y;
    if (cta) {
      const fill = legibleAccent(bg, p);
      const pill = await ctaPill(cta, m, fy + 8 * u * g, W - 2 * m, pillSize, fill, textOn(fill, p));
      shapes.push(pill.shape);
      blocks.push(pill.block);
      contentH = fy + 8 * u * g + pill.h;
    }
    return { blocks, shapes, contentH, headSize: head.size };
  };

  const MIN_HEAD = 78 * u;
  const calm = await calmExtent(art, H);
  const cap = H * (tall ? 0.38 : 0.44);
  const shift = (r: { blocks: TextBlock[]; shapes: string[] }, dy: number) => {
    r.blocks.forEach((b) => (b.y += dy));
    r.shapes = r.shapes.map((s) => s.replace(/(<rect x="[\d.]+" y=")([\d.]+)"/, (_m, a, y) => `${a}${(Number(y) + dy).toFixed(1)}"`));
  };

  // 0. A product scene (keepWhole): the type and the product are one group. The scene is enlarged around the
  //    product, never cropped through it, until the group fills the frame; the type is anchored to the top of
  //    the scene's content with a deliberate margin; and the whole group is centred vertically. No dead band.
  const KEEPS = [{ label: true, sub: true }, { label: false, sub: true }, { label: false, sub: false }];
  const sizeText = async (zone: number, keep: (typeof KEEPS)[number]) => {
    const t = await build(zone, p.dark, p.light, p.light, p.light, keep);
    return t.headSize >= MIN_HEAD && t.contentH <= zone ? { keep, contentH: t.contentH, headSize: t.headSize } : null;
  };
  const groupedScene = async (): Promise<Buffer | null> => {
    if (calm.top < 140 * u) return null; // the top of the scene is not calm: there is no place for type
    const meta = await sharp(spec.artwork!).metadata();
    let box: Box | null = spec.productBox ? mapSceneBox(spec.productBox, meta.width ?? W, meta.height ?? H, W, H) : null;
    if (box && (box.right - box.left < 0.1 * W || box.bottom - box.top < 0.08 * H)) box = null;
    // With no box (SAM did not find the product in the scene), assume it is centred and fills about half the width.
    if (!box) box = { left: W * 0.25, right: W * 0.75, top: Math.max(calm.top, H * 0.3), bottom: H - Math.max(calm.bottom, H * 0.08) };
    const gp = groupParams(W, H, u, m, f);
    const g = gapK(spec);
    const G = Math.max(14 * u, gp.G0 * Math.pow(g, 1.5)); // a spacing note moves this by a clear step
    // The scene's own surface (fabric, a table) can sit between the calm wall and the product. When it is wide, the
    // wall colour is carried down as a clean header panel that ends just above the product, so type and product
    // read as one group; when it is narrow the type simply sits on the wall above it.
    const surface = box.top - calm.top;
    let usePanel = surface > 0.06 * H;
    if (usePanel) {
      const dist = (a: string, b: string) => [1, 3, 5].reduce((n, i) => n + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
      const wallColour = await bandColour(art, W, Math.max(0, Math.round(calm.top) - 24), 20);
      const stripTop = Math.round(calm.top) + 6;
      const stripColour = await bandColour(art, W, stripTop, Math.max(4, Math.min(Math.round(box.top) - 6, stripTop + 60) - stripTop));
      usePanel = dist(wallColour, stripColour) > 60; // a shaded wall is still wall: no panel, and no seam
    }
    const contentTop = usePanel ? box.top : Math.min(box.top, calm.top);
    const hc = box.bottom - contentTop;
    const sMax = Math.max(1, Math.min(gp.sMax, (W - 2 * m) / (box.right - box.left)));
    const cx = (box.left + box.right) / 2;

    // Keep all the copy if it can be done: try the full type block at every zoom before giving up the label or the subline.
    for (const keep of KEEPS) {
      // A first estimate of the type block's height, at a moderate zone (a roomier one when extra spacing makes the block taller).
      let probe = null;
      for (const frac of [0.3, 0.4, 0.5]) {
        probe = await sizeText(H * frac, keep);
        if (probe) break;
      }
      if (!probe) continue;
      // How far to enlarge so type, margin and content fill the frame. A tighter note enlarges more, a looser one less.
      const sTarget = Math.max(1, Math.min(sMax, ((H - gp.topM - gp.botM - G - probe.contentH) / hc) * Math.pow(g, -0.35)));
      for (let s = sTarget; s >= 1 - 1e-6; s -= 0.04) {
        const sc = Math.max(1, s);
        const slackY = (sc - 1) * H;
        const slackX = (sc - 1) * W;
        let y0 = Math.max(-slackY, Math.min(0, H - gp.botM - box.bottom * sc)); // product bottom as low as the margin and coverage allow
        const x0 = Math.max(-slackX, Math.min(0, W / 2 - cx * sc));
        if (x0 + box.left * sc < m * 0.4 || x0 + box.right * sc > W - m * 0.4) continue; // the product must stay whole, with air at the sides
        const ctY = y0 + contentTop * sc;
        const zone = ctY - G - gp.topM;
        if (zone < 140 * u) continue;
        const t = await sizeText(zone, keep);
        if (!t) continue;
        let T = ctY - G - t.contentH;
        // Centre the group: equal space above the type and below the product, within what the scene and the margins allow.
        const prodBottom = y0 + box.bottom * sc;
        let dy = (H - prodBottom - T) / 2;
        dy = Math.max(-slackY - y0, Math.min(-y0, dy)); // the enlarged scene must still cover the frame
        dy = Math.max(gp.topM - T, dy); // the type keeps its top margin
        dy = Math.min(dy, H - gp.botM * 0.6 - prodBottom); // the product keeps a bottom margin
        y0 += dy;
        T += dy;

        const scaledW = Math.round(W * sc);
        const scaledH = Math.round(H * sc);
        const placed =
          sc > 1
            ? await sharp(await sharp(art).resize(scaledW, scaledH, { kernel: "lanczos3" }).png().toBuffer())
                .extract({ left: Math.min(scaledW - W, Math.max(0, Math.round(-x0))), top: Math.min(scaledH - H, Math.max(0, Math.round(-y0))), width: W, height: H })
                .png()
                .toBuffer()
            : art;
        const wallEnd = y0 + calm.top * sc; // where the wall ends in the placed scene
        // When only a sliver of wall would show above the panel, the panel starts at the top edge instead of leaving a stripe.
        const panelTop = wallEnd < 48 * u ? 0 : Math.max(0, Math.round(wallEnd) - 2);
        const panelBottom = Math.round(y0 + contentTop * sc - 0.4 * G); // just above the product, with a small margin
        const panel = usePanel && panelBottom > panelTop + 20;
        const bg = panel
          ? await bandColour(placed, W, Math.max(0, Math.round(wallEnd) - 26), Math.max(4, Math.round(wallEnd) - 3 - Math.max(0, Math.round(wallEnd) - 26)))
          : await bandColour(placed, W, Math.max(0, Math.round(T) - 6), Math.round(Math.min(H - Math.max(0, Math.round(T) - 6), t.contentH + 12)));
        const fg = textOn(bg, p);
        const text = await build(zone, bg, fg, mix(bg, fg, 0.78), legibleAccent(bg, p), t.keep);
        shift(text, T);
        let panelSvg = "";
        if (panel) {
          const rule = Math.max(4, Math.round(6 * u));
          panelSvg =
            `<rect x="0" y="${panelTop}" width="${W}" height="${panelBottom - panelTop}" fill="${bg}"/>` +
            `<rect x="0" y="${panelBottom - rule}" width="${W}" height="${rule}" fill="${p.accents[0]}"/>`;
        }
        const textBottom = T + t.contentH;
        const productTop = y0 + box.top * sc;
        spec.onLayout?.({
          mode: "grouped", zoom: Math.round(sc * 1000) / 1000, gapPx: Math.round(y0 + contentTop * sc - textBottom), productGapPx: Math.round(productTop - textBottom),
          textTop: Math.round(T), textBottom: Math.round(textBottom), productTop: Math.round(productTop), productBottom: Math.round(y0 + box.bottom * sc),
          productLeft: Math.round(x0 + box.left * sc), productRight: Math.round(x0 + box.right * sc), headSize: Math.round(t.headSize),
          keptLabel: t.keep.label, keptSubline: t.keep.sub,
          ...(panel ? { panel: { top: panelTop, bottom: panelBottom } } : {}),
        });
        const picture = panelSvg ? await sharp(placed).composite([{ input: rasterSvg(svgWrap(W, H, panelSvg), W) }]).png().toBuffer() : placed;
        const finished = await finishImage(picture, { palette: p, strength: spec.finish, seed: Math.round(T), localContrast: 0.35 });
        return sharp(finished)
          .composite([{ input: rasterSvg(svgWrap(W, H, text.shapes.join("")), W) }, { input: await renderTextLayer(text.blocks, W, H) }])
          .png()
          .toBuffer();
      }
    }
    return null;
  };
  if (spec.keepWhole) {
    const grouped = await groupedScene();
    if (grouped) return grouped;
  }

  // 1. Type straight onto the calm top (or bottom) of the picture, when there is enough of it.
  // A real product scene only takes type at the top: at the bottom it could land on the product itself.
  for (const side of (spec.keepWhole ? ["top"] : ["top", "bottom"]) as Array<"top" | "bottom">) {
    const zone = Math.min(side === "top" ? calm.top : calm.bottom, cap) - (side === "top" ? f.top : f.bottom * 0.6) - 8 * u;
    if (zone < 140 * u) continue;
    const bg = await bandColour(art, W, side === "top" ? 0 : H - Math.round(zone), Math.round(zone));
    const fg = textOn(bg, p);
    for (const keep of [{ label: true, sub: true }, { label: false, sub: true }, { label: false, sub: false }]) {
      const attempt = await build(zone, bg, fg, mix(bg, fg, 0.78), legibleAccent(bg, p), keep);
      if (attempt.headSize >= MIN_HEAD && attempt.contentH <= zone) {
        const at = side === "top" ? f.top : H - (tall ? f.bottom * 0.7 : m) - attempt.contentH;
        shift(attempt, at);
        spec.onLayout?.({
          mode: "calm-top", zoom: 1, gapPx: Math.round((side === "top" ? calm.top : H - calm.bottom) - (at + attempt.contentH)), productGapPx: 0,
          textTop: Math.round(at), textBottom: Math.round(at + attempt.contentH), productTop: 0, productBottom: 0, productLeft: 0, productRight: 0, headSize: Math.round(attempt.headSize),
        });
        const finishedArt = await finishImage(art, { palette: p, strength: spec.finish, seed: Math.round(at), localContrast: 0.35 });
        return sharp(finishedArt)
          .composite([{ input: rasterSvg(svgWrap(W, H, attempt.shapes.join("")), W) }, { input: await renderTextLayer(attempt.blocks, W, H) }])
          .png()
          .toBuffer();
      }
    }
  }

  // 2. No calm space. A real product scene is never cropped, smeared or covered, so the caller
  //    falls back to a clean palette background instead. Other artwork gets a flat text band.
  if (spec.keepWhole) throw new Error(NO_CALM_SPACE);
  const attempt = await build(Math.min(cap, H * 0.3), p.dark, p.light, mix(p.dark, p.light, 0.78), legibleAccent(p.dark, p));
  const bandH = Math.round(attempt.contentH + 2 * pad + 7 * u);
  shift(attempt, pad + 7 * u);
  const picture = await sharp(spec.artwork).resize(W, H - bandH, { fit: "cover", position: "bottom" }).png().toBuffer();
  const band = svgWrap(W, bandH, `<rect width="${W}" height="${bandH}" fill="${p.dark}"/><rect y="${bandH - 7 * u}" width="${W}" height="${7 * u}" fill="${p.accents[0]}"/>`);
  const bandBase = await sharp({ create: { width: W, height: H, channels: 3, background: p.dark } })
    .composite([{ input: picture, left: 0, top: bandH }, { input: rasterSvg(band, W), left: 0, top: 0 }])
    .png()
    .toBuffer();
  const bandFinished = await finishImage(bandBase, { palette: p, strength: spec.finish, seed: bandH, localContrast: 0.35 });
  return sharp(bandFinished)
    .composite([{ input: rasterSvg(svgWrap(W, H, attempt.shapes.join("")), W) }, { input: await renderTextLayer(attempt.blocks, W, H) }])
    .png()
    .toBuffer();
}

/**
 * The real product on one clean background from the palette (a smooth wash, no panels), with a
 * soft contact shadow. This is the fallback whenever a generated scene cannot be made clean.
 */
async function product(spec: DesignSpec, p: Palette, f: Frame): Promise<Buffer> {
  const { W, H, u, m, k } = f;
  if (!spec.product) throw new Error("product layout needs a product cut-out");
  const lum = await productLuminance(spec.product);
  // A dark product reads best on a light ground, and the other way round.
  const forcedGround = effectGround(spec.effect);
  // Sticker Pack: one flat colour, with the text in a contrasting ink.
  const flat = spec.sticker ? p.accents[0] : null;
  const lightTheme = flat ? luminance(flat) > 0.4 : forcedGround ? forcedGround === "light" : lum < 0.38;
  const bg = flat ?? (lightTheme ? (forcedGround === "light" ? mix(p.light, p.dark, 0.04) : p.light) : forcedGround === "dark" ? mix(p.dark, "#000000", 0.55) : p.dark);
  const fg = textOn(bg, p);
  const wash = flat ? bg : mix(bg, p.accents[0], lightTheme ? 0.1 : 0.16);
  const { label, sub, cta, details } = parts(spec);
  const blocks: TextBlock[] = [];
  const shapes: string[] = [];

  let y = f.top;
  // A magazine cover on the studio layout too: the shop's name is one big masthead word above the product, and the headline is the cover line.
  const mast = spec.masthead ? mastheadWord(label) : null;
  if (mast) {
    shapes.push(`<rect x="${m}" y="${Math.round(f.top - 18 * u)}" width="${W - 2 * m}" height="${Math.max(2, 3 * u)}" fill="${fg}" fill-opacity="0.8"/>`);
    const strap = Math.max(20 * u, await fitLine(clean(spec.headline, 60), (W - 2 * m) * 0.9, 40 * u * k, "body-bold", true, 0.1));
    blocks.push({ text: clean(spec.headline, 60), x: m, y, width: W - 2 * m, size: strap, font: "body-bold", color: mix(bg, fg, 0.95), letterSpacing: strap * 0.1, uppercase: true });
    y += strap * 1.7;
  } else if (label) {
    blocks.push({ text: label, x: m, y, width: W - 2 * m, size: 24 * u * k, font: "body-bold", color: legibleAccent(bg, p), letterSpacing: 24 * u * k * 0.2, uppercase: true });
    y += 62 * u * k;
  }
  const step = FIT_STEPS[Math.min(spec.fitStep ?? 0, FIT_STEPS.length - 1)];
  const hk = headK(spec) * step.k * (spec.photoPanel ? 0.85 : 1);
  const head = await headlineBlocks(clean(mast ?? spec.headline, 60), m, y, (W - 2 * m) * hk, 0.2 * H * hk, mast ? 1 : step.lines, 220 * u * hk, fg);
  // A one-line step only counts when the line stays big. If it would have to be small, go on to the next step.
  if (!mast && step.lines === 1 && head.size < 70 * u && (spec.fitStep ?? 0) < FIT_STEPS.length - 1) return product({ ...spec, fitStep: (spec.fitStep ?? 0) + 1 }, p, f);
  blocks.push(...head.blocks);
  let cursor = head.bottom;
  if (sub) {
    const size = await fitLine(sub, W - 2 * m, 34 * u * k, "body");
    blocks.push({ text: sub, x: m, y: cursor + 16 * u * gapK(spec), width: W - 2 * m, size, font: "body", color: lightTheme ? mix(p.light, p.dark, 0.7) : mix(p.dark, p.light, 0.78) });
    cursor += 16 * u * gapK(spec) + size * 1.3;
  }
  if (details.length) {
    const text = details.join("   ·   ");
    const size = await fitLine(text, W - 2 * m, 30 * u * k, "display-semi", true, 0.04);
    blocks.push({ text, x: m, y: cursor + 18 * u, width: W - 2 * m, size, font: "display-semi", color: legibleAccent(bg, p), letterSpacing: size * 0.04, uppercase: true });
    cursor += 18 * u + size * 1.3;
  }

  let pillH = 0;
  let pillRight = 0;
  const pillSize = 38 * u * tallScale(f) * ctaK(spec);
  if (cta) {
    const fill = legibleAccent(bg, p);
    const pill = await ctaPill(cta, m, H - f.bottom - pillSize * 1.95, W - 2 * m, pillSize, fill, textOn(fill, p));
    shapes.push(pill.shape);
    blocks.push(pill.block);
    pillH = pill.h + 30 * u;
    pillRight = m + pill.w;
  }

  const textBlocks = blocks.slice(0, blocks.length - (cta ? 1 : 0)); // everything above the pill
  // Callouts (Spec Sheet): a row of short labels under the product, from the fact column only.
  const callouts = (spec.callouts ?? []).map((c) => clean(c, 30)).filter(Boolean).slice(0, 3);
  let calloutH = 0;
  let calloutRow: { texts: { text: string; w: number }[]; size: number; pad: number; gap: number } | null = null;
  if (callouts.length) {
    let size = 26 * u * k;
    const pad = 16 * u;
    const gap = 14 * u;
    const widths = async (sz: number) => Promise.all(callouts.map(async (c) => ({ text: c, w: (await measure100(c, "body-bold", false, 0)) * (sz / 100) + 2 * pad })));
    let texts = await widths(size);
    const total = (t: { w: number }[]) => t.reduce((a, b) => a + b.w, 0) + gap * (t.length - 1);
    while (total(texts) > W - 2 * m && size > 14 * u) { size *= 0.92; texts = await widths(size); }
    calloutRow = { texts, size, pad, gap };
    calloutH = size * 1.9 + 18 * u;
  }
  const grow = Math.max(0, productK(spec) - 1) / 0.3; // 0 to 1: how much more room a larger product is given
  // The product keeps a clear gap under the subline (or the headline): a sticker outline is drawn beyond the product, so it needs its own room.
  // The product starts at least about 3 percent of the frame height below the last line, whatever the gap setting, and a sticker outline needs its own room.
  const boxTop = Math.round(cursor + Math.max(26 * u, (spec.photoPanel ? 16 : 30 - 10 * grow) * u * gapK(spec)) + (spec.sticker ? 18 * u : 0));
  // A product asked to be larger may use part of the strip beside the call to action, down to the bottom margin. A tall product is
  // limited by height, so without this a "bigger" note changed nothing.
  const boxBottom = H - f.bottom - pillH - 14 * u - calloutH + grow * Math.min(pillH - 14 * u, 70 * u);
  const boxW = Math.round(Math.min(W * 0.95, W * 0.9 * productK(spec)));
  let boxH = Math.max(120, Math.round((boxBottom - boxTop) * Math.min(1, productK(spec))));
  let prod = await sharp(spec.product).resize({ width: boxW, height: boxH, fit: "inside" }).png().toBuffer();
  let pm = await sharp(prod).metadata();
  let pw = pm.width ?? boxW;
  let ph = pm.height ?? boxH;
  let px = Math.round((W - pw) / 2);
  // The whole original photo is drawn as large as the ad allows, at least 60 percent of its height when that does not clip it.
  // It may run down beside the call to action, as long as it stays clear of the button.
  if (spec.photoPanel) {
    const top = Math.round(cursor + 16 * u);
    const tallH = Math.max(120, Math.round(H - f.bottom * 0.4 - 4 * u - top));
    const tall = await sharp(spec.product).resize({ width: boxW, height: tallH, fit: "inside" }).png().toBuffer();
    const tm = await sharp(tall).metadata();
    const tw = tm.width ?? boxW;
    // Centred if that clears the button; otherwise moved right just far enough to clear it, if the frame has the room.
    const tpx = Math.max(Math.round((W - tw) / 2), Math.round(pillRight + 16 * u));
    if ((tm.height ?? 0) > ph && tpx + tw <= W - m / 2) {
      prod = tall; pm = tm; pw = tw; ph = tm.height ?? tallH; px = tpx;
      boxH = tallH;
    }
  }
  // A product asked to be larger goes down to the bottom margin when it stays clear of the call to action.
  if (!spec.photoPanel && grow > 0 && calloutH === 0) {
    const tallH = Math.max(120, Math.round(H - f.bottom - 4 * u - boxTop));
    const tall = await sharp(spec.product).resize({ width: boxW, height: tallH, fit: "inside" }).png().toBuffer();
    const tm = await sharp(tall).metadata();
    const tpx = Math.round((W - (tm.width ?? boxW)) / 2);
    if ((tm.height ?? 0) > ph * 1.01 && tpx >= pillRight + 16 * u) {
      prod = tall; pm = tm; pw = tm.width ?? boxW; ph = tm.height ?? tallH; px = tpx;
      boxH = tallH;
    }
  }
  // The headline gives way before the product gets small: when the product filled the room it had and is still under 45 percent of the height, try again with one line, then smaller type.
  if (!spec.photoPanel && !mast && ph < MIN_PRODUCT_SHARE * H && ph >= boxH * 0.98 && (spec.fitStep ?? 0) < FIT_STEPS.length - 1) return product({ ...spec, fitStep: (spec.fitStep ?? 0) + 1 }, p, f);
  // Type and product are one group: the product sits right under the type, and any spare height is split
  // above the type and below the product instead of opening a band between them.
  const dy = Math.max(0, Math.round((boxH - ph) / 2));
  textBlocks.forEach((b) => (b.y += dy));
  const py = boxTop + dy;
  spec.onLayout?.({ mode: "composite", zoom: 1, gapPx: Math.round(py - cursor - dy), productGapPx: Math.round(py - cursor - dy), textTop: Math.round(f.top + dy), textBottom: Math.round(cursor + dy), productTop: py, productBottom: py + ph, productLeft: px, productRight: px + pw, headSize: Math.round(head.size), headlineBounds: inkBounds(await lineInk(head.blocks, W, H), W) });
  if (calloutRow) {
    const rowW = calloutRow.texts.reduce((a, b) => a + b.w, 0) + calloutRow.gap * (calloutRow.texts.length - 1);
    let cx = (W - rowW) / 2;
    const cy = py + ph + 12 * u;
    const hgt = calloutRow.size * 1.9;
    for (const t of calloutRow.texts) {
      shapes.push(`<rect x="${cx}" y="${cy}" width="${t.w}" height="${hgt}" rx="${hgt / 2}" fill="${mix(bg, fg, 0.1)}" stroke="${mix(bg, fg, 0.35)}" stroke-width="${Math.max(1.5, 2 * u)}"/>`);
      blocks.push({ text: t.text, x: cx + calloutRow.pad, y: cy + (hgt - calloutRow.size) / 2 - calloutRow.size * 0.02, width: t.w - 2 * calloutRow.pad, size: calloutRow.size, font: "body-bold", color: fg });
      cx += t.w + calloutRow.gap;
    }
  }
  const shadowW = Math.round(pw * 0.8);
  const shadowH = Math.max(10, Math.round(ph * 0.05));
  const ground = svgWrap(
    W,
    H,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${wash}"/></linearGradient>` +
      `<filter id="b" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="${14 * u}"/></filter></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
      `<ellipse cx="${W / 2}" cy="${py + ph - shadowH * 0.2}" rx="${shadowW / 2}" ry="${shadowH}" fill="#000000" fill-opacity="0.32" filter="url(#b)"/>`,
  );

  let groundPng = rasterSvg(ground, W);
  let drawn: Buffer = prod;
  let outline: { png: Buffer; offset: number } | null = null;
  if (spec.effect) {
    const colours = effectColours(p, spec.effectMuted);
    groundPng = await applyBackgroundEffect(groundPng, spec.effect, colours, { cx: px + pw / 2, cy: py + ph / 2, r: Math.max(pw, ph) / 2 }, textRects(blocks, W, u, cta ? clean(spec.cta, 64) : ""));
    outline = await productOutlineLayer(prod, spec.effect, colours, u);
    if (spec.effect.stylise) drawn = await stylisedProduct(prod, spec.effect, colours);
  }
  // The sticker border: a thick white outline, grown from the product's own silhouette, under the product.
  if (spec.sticker) outline = await stickerBorder(prod, Math.max(6, Math.round(16 * u)));
  const productBase = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: groundPng }, ...(outline ? [{ input: outline.png, left: px - outline.offset, top: py - outline.offset }] : []), { input: drawn, left: px, top: py }])
    .png()
    .toBuffer();
  const productFinished = await finishImage(productBase, { palette: p, strength: spec.finish, seed: py });
  shapes.push(...(await legibleSmallType(productFinished, blocks, W, H)));
  return sharp(productFinished)
    .composite([{ input: rasterSvg(svgWrap(W, H, shapes.join("")), W) }, { input: await renderTextLayer(blocks, W, H) }])
    .png()
    .toBuffer();
}

/**
 * A light along the top left edge of a cut-out, the way a rim light would catch it: the part of the product whose
 * up-left neighbour is empty. Returns an overlay of the same size as the product.
 */
async function rimOverlay(prod: Buffer, colour: string, strength: number, u: number): Promise<Buffer | null> {
  if (strength <= 0) return null;
  const { data, info } = await sharp(prod).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const d = Math.max(3, Math.round(5 * u));
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      const nx = x - d;
      const ny = y - d;
      const neighbour = nx < 0 || ny < 0 ? 0 : data[(ny * w + nx) * 4 + 3];
      const rim = Math.max(0, a - neighbour) / 255;
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(Math.min(1, rim) * 255 * 0.62 * strength);
    }
  }
  // Soften it a little so it reads as light and not as an outline.
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).blur(Math.max(0.8, u * 1.4)).png().toBuffer();
}

// ---- Overlap guard for type behind the product -----------------------------------------------

/** Thrown when no placement keeps the headline readable behind the product; the caller uses the studio layout instead. */
export const OVERLAP_UNFIXABLE = "OVERLAP_UNFIXABLE";

export const LAST_LINE_MIN = 0.85; // the last headline line must be at least this visible
export const OTHER_LINE_MIN = 1; // every other line must be fully visible
export const HEADLINE_CLEAR = 0.999; // the product may hide at most 1 percent of the last headline line: in practice none of it
// The product starts this far down the last line (as a share of its size). The glyphs end near 0.86, so 0.8 leaves a light overlap,
// about 8 percent of the letters at most. It was 0.72, which covered 7 to 15 percent of the last line on the real cut-outs.
const OVERLAP_DEPTH = 0.8;
const GUARD_STEP = 0.05; // each step of a tightened guard asks for this much more of the last line

/** The visibility limits at a guard level: level 0 is 85 percent of the last line and all of the others. */
export function overlapLimits(level: number | undefined, masthead = false): { last: number; other: number } {
  const n = typeof level === "number" && Number.isFinite(level) ? Math.max(0, Math.min(4, Math.round(level))) : 0;
  // A product never covers the headline. Only a magazine masthead, which is a design flourish, keeps the old allowance.
  if (!masthead) return { last: Math.min(1, HEADLINE_CLEAR + n * 0.005), other: OTHER_LINE_MIN };
  return { last: Math.min(1, LAST_LINE_MIN + n * GUARD_STEP), other: OTHER_LINE_MIN };
}

export interface LineInk {
  pixels: Int32Array; // canvas pixel index of every inked pixel of the line, where the line was drawn
  y: number; // the line block's y when it was drawn
}

/** The inked pixels of each headline line, drawn one at a time so lines cannot hide each other. */
export async function lineInk(blocks: TextBlock[], W: number, H: number): Promise<LineInk[]> {
  return Promise.all(
    blocks.map(async (b) => {
      const { data, info } = await sharp(await renderTextLayer([b], W, H)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const out: number[] = [];
      for (let i = 0; i < W * H; i++) if (data[i * info.channels + 3] > 100) out.push(i);
      return { pixels: Int32Array.from(out), y: b.y };
    }),
  );
}

/** The box the headline's ink fills, from the ink of its lines. */
export function inkBounds(ink: readonly LineInk[], W: number, shiftY: number[] = []): { left: number; right: number; top: number; bottom: number } {
  let left = Infinity, right = -1, top = Infinity, bottom = -1;
  ink.forEach((line, i) => {
    const dy = Math.round(shiftY[i] ?? 0);
    for (let k = 0; k < line.pixels.length; k++) {
      const p = line.pixels[k];
      const x = p % W;
      const y = (p - x) / W + dy;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  });
  return right < 0 ? { left: 0, right: 0, top: 0, bottom: 0 } : { left, right, top, bottom };
}

/** Share of each line's ink the product leaves visible when the lines are at ys and the product's top left is at (px, py). */
export function visibleShares(ink: readonly LineInk[], ys: readonly number[], alpha: Buffer, pw: number, ph: number, px: number, py: number, W: number): number[] {
  return ink.map((line, i) => {
    const dy = Math.round(ys[i] - line.y); // a fractional shift would index between pixels
    let covered = 0;
    for (let k = 0; k < line.pixels.length; k++) {
      const p = line.pixels[k];
      const x = p % W;
      const rx = x - px;
      const ry = (p - x) / W + dy - py;
      if (rx >= 0 && rx < pw && ry >= 0 && ry < ph && alpha[ry * pw + rx] > 128) covered++;
    }
    return line.pixels.length ? 1 - covered / line.pixels.length : 1;
  });
}

const passes = (shares: readonly number[], g: { last: number; other: number }): boolean =>
  shares.every((s, i) => s >= (i === shares.length - 1 ? g.last : g.other) - 0.0005);

const SHRINKS = [1, 0.92, 0.84, 0.76, 0.68]; // the headline's size, as a share of what the width allows

interface BehindFit {
  head: { blocks: TextBlock[]; bottom: number; size: number };
  prod: Buffer;
  pw: number;
  ph: number;
  py: number;
  ls: number;
  lastTop: number;
  shift: number;
  steps: string[];
  visible: number[];
  bounds: { left: number; right: number; top: number; bottom: number };
}

/**
 * The order of remedies, on its own so it can be tested without drawing anything. For each headline size (largest
 * first) it tries moving the headline up, a step at a time as far as `room` allows; if no size works that way, it
 * tries again with the headline as high as it can go and the product pushed lower, a step at a time. Moving up is
 * therefore preferred to shrinking, and shrinking to pushing. Null when nothing works.
 */
export function chooseRemedy(o: {
  sizes: number; // how many headline sizes there are, index 0 the largest
  room: (size: number) => number; // how far the headline can move up at this size
  lower: (size: number) => number; // how far the product can be pushed down at this size
  ok: (size: number, up: number, push: number) => boolean;
  step: number;
}): { size: number; up: number; push: number } | null {
  for (let size = 0; size < o.sizes; size++) {
    const room = o.room(size);
    if (o.ok(size, 0, 0)) return { size, up: 0, push: 0 };
    for (let up = o.step; up <= room; up += o.step) if (o.ok(size, up, 0)) return { size, up, push: 0 };
    if (room > 0 && o.ok(size, room, 0)) return { size, up: room, push: 0 };
  }
  for (let size = 0; size < o.sizes; size++) {
    const room = o.room(size);
    const lower = o.lower(size);
    for (let push = o.step; push <= lower; push += o.step) if (o.ok(size, room, push)) return { size, up: room, push };
  }
  return null;
}

/** The masthead word of a magazine cover: the first word of the shop's name, or the whole name when that word is very short. Null with no name. */
export function mastheadWord(label: string): string | null {
  const name = label.trim();
  if (!name) return null;
  const first = name.split(" ")[0];
  return (first.length >= 3 ? first : name).slice(0, 16);
}

const WHITE = "#FFFFFF";
const NEAR_BLACK = "#111111";
/** The smallest contrast between small type and the picture under it that still reads on a phone. */
export const LEGIBLE_RATIO = 4.5;

/**
 * Small type (the subline, the cover line, a label) is chosen against the plain field, but an effect draws halftone dots, bursts and
 * graded colour over that field. This looks at the real pixels under each small line of a finished picture; where the worst fifth of
 * them is too close to the text colour, the line is switched to white or black, whichever reads better, on a soft backing of the other
 * colour. It changes the block colours in place and returns the backing shapes. Layout engine only, no model call.
 */
export async function legibleSmallType(picture: Buffer, blocks: TextBlock[], W: number, H: number): Promise<string[]> {
  const shapes: string[] = [];
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  for (const b of blocks) {
    const isSub = b.font === "body" && !b.uppercase;
    const isStrap = b.uppercase === true && (b.letterSpacing ?? 0) > 0;
    if ((!isSub && !isStrap) || !/^#[0-9a-f]{6}$/i.test(b.color)) continue;
    const textW = Math.min(b.width, ((await measure100(b.text, b.font, !!b.uppercase, (b.letterSpacing ?? 0) / b.size)) * b.size) / 100);
    const left0 = b.align === "right" ? b.x + b.width - textW : b.align === "center" ? b.x + (b.width - textW) / 2 : b.x;
    const left = Math.max(0, Math.round(left0));
    const top = Math.max(0, Math.round(b.y));
    const width = Math.min(W - left, Math.ceil(textW));
    const height = Math.min(H - top, Math.ceil(b.size * 1.25));
    if (width < 4 || height < 4) continue;
    const { data, info } = await sharp(picture).extract({ left, top, width, height }).resize({ width: Math.min(width, 96), height: Math.min(height, 16), fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lt = luminance(b.color);
    const lums: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) lums.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
    const ratio = (l: number) => (Math.max(l, lt) + 0.05) / (Math.min(l, lt) + 0.05);
    const worst = lums.map(ratio).sort((a, c) => a - c)[Math.floor(lums.length * 0.2)];
    if (worst >= LEGIBLE_RATIO) continue;
    const mean = lums.reduce((a, c) => a + c, 0) / lums.length;
    const text = (mean + 0.05) / (luminance(NEAR_BLACK) + 0.05) >= (luminance(WHITE) + 0.05) / (mean + 0.05) ? NEAR_BLACK : WHITE;
    const back = text === WHITE ? "#000000" : WHITE;
    const padX = b.size * 0.45;
    const padY = b.size * 0.22;
    shapes.push(`<rect x="${Math.round(left0 - padX)}" y="${Math.round(b.y - padY * 0.2)}" width="${Math.round(textW + 2 * padX)}" height="${Math.round(b.size * 1.25 + padY)}" rx="${Math.round(b.size * 0.35)}" fill="${back}" fill-opacity="${text === WHITE ? 0.5 : 0.6}"/>`);
    b.color = text;
  }
  return shapes;
}

/** Each headline line as its whole bounding box (every pixel inside it), so a thin handle between two letters still counts as touching the line. */
function boxedInk(ink: LineInk[], W: number): LineInk[] {
  return ink.map((l) => {
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    for (const px of l.pixels) { const x = px % W; const y = (px - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return l;
    const out = new Int32Array((x1 - x0 + 1) * (y1 - y0 + 1));
    let i = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[i++] = y * W + x;
    return { pixels: out, y: l.y };
  });
}

interface Prep {
  mAlpha: Buffer; // the alpha the overlap is measured with: the product, plus its outline when an effect draws one
  mw: number;
  mh: number;
  pad: number;
  scale: number;
  head: { blocks: TextBlock[]; bottom: number; size: number };
  prod: Buffer;
  pw: number;
  ph: number;
  py: number;
  ls: number;
  lastTop: number;
  shift: number;
  px: number;
  alpha: Buffer;
  ink: LineInk[];
  boxInk: LineInk[];
  room: number;
  lower: number;
}

/**
 * Places the headline and the product for type behind the product, then enforces the overlap limits on the real
 * pixels. The order of remedies is: move the headline up, shrink it, push the product lower (see chooseRemedy).
 * When all of them fail it throws OVERLAP_UNFIXABLE.
 */
async function fitBehind(o: { spec: DesignSpec; f: Frame; ink: string; labelH: number; zoneTop: number; zoneBottom: number; footerY: number; guard: { last: number; other: number } }): Promise<BehindFit> {
  const { spec, f, ink, labelH, zoneTop, zoneBottom, footerY, guard } = o;
  const { W, H, u, m } = f;
  const pk = productK(spec);
  const hk = headK(spec);
  const maxW = Math.round(Math.min(W * 0.9, W * (f.tall ? 0.8 : 0.62) * pk));
  const maxHeadH = (zoneBottom - zoneTop) * (f.tall ? 0.42 : 0.4) * hk;
  const stepPx = Math.max(4, Math.round(6 * u));

  const prepare = async (scale: number): Promise<Prep> => {
    // Tall formats have the height for three lines and a bigger product, so the group fills the frame instead of floating in it.
    const head = await headlineBlocks(clean(spec.headline, 60), m, zoneTop, (W - 2 * m) * hk, maxHeadH * scale, spec.masthead ? 1 : f.tall ? 3 : 2, 360 * u, ink, true);
    const last = head.blocks[head.blocks.length - 1];
    const ls = last.size;
    const lastTop = last.y;
    const maxH = Math.max(80 * u, (zoneBottom - (lastTop + OVERLAP_DEPTH * ls)) * Math.min(1, pk));
    const prod = await sharp(spec.product as Buffer).resize({ width: maxW, height: Math.round(maxH), fit: "inside" }).png().toBuffer();
    const pm = await sharp(prod).metadata();
    const pw = pm.width ?? maxW;
    const ph = pm.height ?? maxH;
    // Read the alpha with the channel count sharp really returns (see cutoutMask.ts: a 1-channel read came back as 3).
    const rgba = await sharp(prod).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = Buffer.alloc(rgba.info.width * rgba.info.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba.data[i * rgba.info.channels + 3];
    // A product limited by its width is shorter than the room: sit it on the footer and move the headline down to meet it.
    let py = Math.round(zoneBottom - ph);
    let shift = py - OVERLAP_DEPTH * ls - lastTop;
    // Centre the whole group between the top inset and the footer.
    const groupTop = zoneTop - labelH + shift;
    const spare = zoneBottom - py - ph + (groupTop - f.top);
    const centre = spare > 0 ? Math.min(shift < 0 ? 0 : spare / 2, (f.tall ? 400 : 120) * u) : 0;
    py = Math.round(py - centre);
    shift = py - OVERLAP_DEPTH * ls - lastTop;
    const ol = outlineRadius(spec.effect, u);
    const grown = ol > 0 ? await outlineMask(prod, ol) : null;
    return {
      mAlpha: grown ? grown.alpha : alpha, mw: grown ? grown.w : pw, mh: grown ? grown.h : ph, pad: grown ? grown.pad : 0,
      scale, head, prod, pw, ph, py, ls, lastTop, shift, px: Math.round((W - pw) / 2), alpha, ink: await lineInk(head.blocks, W, H), boxInk: [],
      room: Math.max(0, head.blocks[0].y + shift - labelH - f.top * 0.5), // the headline may rise until the label is half the top inset from the edge
      lower: Math.max(0, footerY - 10 * u - (py + ph)), // the product may sink until it nearly meets the footer
    };
  };
  // The product must also keep its distance below the headline (a magazine masthead keeps its overlap): the headline is measured as if it were
  // lower by a few steps up to the minimum gap, so no product pixel, however thin a handle, comes within about 3 percent of the height of it.
  let gapPx = spec.masthead ? 0 : Math.round(MIN_HEADLINE_GAP * H);
  const offsets = () => (gapPx ? [0, 0.34, 0.67, 1].map((k) => Math.round(k * gapPx)) : [0]);
  const measure = (p: Prep, up: number, push: number) => {
    if (!p.boxInk.length && gapPx) p.boxInk = boxedInk(p.ink, W);
    const shares = visibleShares(p.ink, p.head.blocks.map((b) => b.y + p.shift - up), p.mAlpha, p.mw, p.mh, p.px - p.pad, p.py + push - p.pad, W);
    if (!gapPx) return shares;
    // Inside the gap, any product pixel at all in a line's box counts as touching it.
    const ys = (off: number) => p.head.blocks.map((b) => b.y + p.shift - up + off);
    return shares.map((v, i) => {
      for (const off of offsets()) if (off > 0 && visibleShares([p.boxInk[i]], [ys(off)[i]], p.mAlpha, p.mw, p.mh, p.px - p.pad, p.py + push - p.pad, W)[0] < 1) return 0;
      return v;
    });
  };
  const finish = (p: Prep, up: number, push: number): BehindFit => {
    const visible = measure(p, up, push).map((v) => Math.round(v * 1000) / 1000);
    const s = p.shift - up;
    p.head.blocks.forEach((b) => (b.y += s));
    const steps = [
      ...(up > 0 ? [`moved the headline up ${Math.round(up)} px`] : []),
      ...(p.scale < 1 ? [`shrunk the headline to ${Math.round(p.scale * 100)} percent`] : []),
      ...(push > 0 ? [`pushed the product down ${Math.round(push)} px`] : []),
    ];
    return { head: p.head, prod: p.prod, pw: p.pw, ph: p.ph, py: p.py + push, ls: p.ls, lastTop: p.lastTop, shift: s, steps, visible, bounds: inkBounds(p.ink, W, p.head.blocks.map(() => s)) };
  };

  const first = await prepare(SHRINKS[0]);
  if (passes(measure(first, 0, 0), guard)) return finish(first, 0, 0);
  const preps = [first, ...(await Promise.all(SHRINKS.slice(1).map(prepare)))];
  const search = () => chooseRemedy({
    sizes: preps.length, room: (i) => preps[i].room, lower: (i) => preps[i].lower, step: stepPx,
    ok: (i, up, push) => passes(measure(preps[i], up, push), guard),
  });
  let pick = search();
  // The distance below the headline is a preference: when it cannot be had without hiding the headline, the plain overlap limits decide, as before.
  if (!pick && gapPx) { gapPx = 0; pick = search(); }
  if (!pick) throw new Error(OVERLAP_UNFIXABLE);
  return finish(preps[pick.size], pick.up, pick.push);
}

/**
 * Type behind the product: a huge headline set on a bold colour field, with the real product in front of it and
 * overlapping its lower part, so type and object have depth. The product is never cropped. The overlap is set
 * from the headline's size so the top of every letter stays visible. A large soft accent shape sits behind the
 * product, a rim light catches its edge, and the finishing pass grades the whole picture before the small type
 * (label, subline, call to action) is drawn crisp on top.
 */
async function behind(spec: DesignSpec, p: Palette, f: Frame): Promise<Buffer> {
  const { W, H, u, m, k } = f;
  if (!spec.product) throw new Error("behind layout needs a product cut-out");
  const lum = await productLuminance(spec.product);
  const strength = spec.finish === undefined ? 1 : Math.max(0, Math.min(1, spec.finish));

  // The field: the bold accent when the product stands out from it, otherwise whichever of dark and light does.
  const bold = p.accents[0];
  const apart = (c: string) => Math.abs(luminance(c) - lum);
  const forcedGround = effectGround(spec.effect);
  const field = forcedGround === "dark" ? mix(p.dark, "#000000", 0.55) : forcedGround === "light" ? mix(p.light, p.dark, 0.04) : apart(bold) >= 0.14 && contrast(bold, textOn(bold, p)) >= 3 ? bold : [p.dark, p.light].sort((a, b) => apart(b) - apart(a))[0];
  const ink = textOn(field, p);
  const onBold = field === bold;
  const glow = onBold ? mix(field, p.light, 0.34) : bold;
  const rim = mix(onBold ? p.light : bold, "#FFFFFF", 0.45);

  const all = parts(spec);
  // A magazine cover: the shop's name is the masthead, one big bold word across the top that the product overlaps, and the headline
  // becomes the cover line above it. With no shop name the headline itself is the masthead, as before.
  const mast = spec.masthead ? mastheadWord(all.label) : null;
  const sub = all.sub;
  const pillSize = 38 * u * tallScale(f) * ctaK(spec);
  const footerBottom = H - f.bottom * (f.tall ? 0.8 : 1);
  const footerH = pillSize * 1.95;
  const footerY = footerBottom - footerH;
  const blocks: TextBlock[] = [];
  const shapes: string[] = [];

  // Footer: the subline on the left, the call to action on the right.
  let pillW = 0;
  if (all.cta) {
    const probe = await ctaPill(all.cta, 0, footerY, W - 2 * m, pillSize, ink, field);
    pillW = probe.w;
    const fill = onBold ? ink : legibleAccent(field, p);
    const pill = await ctaPill(all.cta, W - m - pillW, footerY, W - 2 * m, pillSize, fill, textOn(fill, p));
    shapes.push(pill.shape);
    blocks.push(pill.block);
  }
  if (sub) {
    const room = W - 2 * m - (pillW ? pillW + 36 * u : 0);
    const size = await fitLine(sub, room, 32 * u * k, "body");
    blocks.push({ text: sub, x: m, y: footerY + footerH / 2 - size * 0.65, width: room, size, font: "body", color: mix(field, ink, 0.86) });
  }

  // Headline: as large as the width allows, in up to two lines, then the product is placed against its last line.
  // The overlap guard then measures how much of each line the product really covers and, if too much, moves the
  // headline up, then shrinks it, then pushes the product lower. If none of that works the layout is refused.
  const strapSize = mast ? Math.max(20 * u, await fitLine(clean(spec.headline, 60), (W - 2 * m) * 0.9, 40 * u * k, "body-bold", true, 0.1)) : 0;
  const labelH = mast ? strapSize * 1.7 : all.label ? 44 * u * k : 0;
  const zoneTop = f.top + labelH;
  const zoneBottom = footerY - 28 * u;
  const fit = await fitBehind({ spec: mast ? { ...spec, headline: mast } : spec, f, ink, labelH, zoneTop, zoneBottom, footerY, guard: overlapLimits(spec.overlapGuard, !!mast) });
  // A magazine masthead has a thin rule above it and one under the cover line, like a printed cover.
  if (spec.masthead) {
    shapes.push(`<rect x="${m}" y="${Math.round(f.top - 18 * u)}" width="${W - 2 * m}" height="${Math.max(2, 3 * u)}" fill="${ink}" fill-opacity="0.8"/>`);
    shapes.push(`<rect x="${m}" y="${Math.round(footerY - 14 * u)}" width="${W - 2 * m}" height="${Math.max(2, 2 * u)}" fill="${ink}" fill-opacity="0.45"/>`);
  }
  const { head, prod, pw, ph, py, ls, lastTop, shift } = fit;
  if (mast) {
    blocks.push({ text: clean(spec.headline, 60), x: m, y: head.blocks[0].y - labelH, width: W - 2 * m, size: strapSize, font: "body-bold", color: mix(field, ink, 0.95), letterSpacing: strapSize * 0.1, uppercase: true });
  } else if (all.label) {
    blocks.push({ text: all.label, x: m, y: head.blocks[0].y - labelH, width: W - 2 * m, size: 22 * u * k, font: "body-bold", color: mix(field, ink, 0.9), letterSpacing: 22 * u * k * 0.2, uppercase: true });
  }
  const px = Math.round((W - pw) / 2);
  const cxm = W / 2;
  const cym = py + ph * 0.52;

  // The ground: the colour field, a very large soft accent shape and a tighter glow behind the product, a contact shadow.
  const big = W * 0.5;
  const tight = Math.max(pw, ph) * 0.62;
  const ground = svgWrap(
    W,
    H,
    `<defs><filter id="bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${big * 0.28}"/></filter>` +
      `<filter id="bt" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${tight * 0.3}"/></filter>` +
      `<filter id="bs" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="${14 * u}"/></filter></defs>` +
      `<rect width="${W}" height="${H}" fill="${field}"/>` +
      `<circle cx="${cxm}" cy="${cym}" r="${big}" fill="${glow}" fill-opacity="${onBold ? 0.55 : 0.4}" filter="url(#bl)"/>` +
      `<circle cx="${cxm}" cy="${cym}" r="${tight}" fill="${glow}" fill-opacity="${onBold ? 0.7 : 0.55}" filter="url(#bt)"/>` +
      `<ellipse cx="${cxm}" cy="${py + ph - 6 * u}" rx="${pw * 0.42}" ry="${Math.max(10, ph * 0.035)}" fill="#000000" fill-opacity="0.38" filter="url(#bs)"/>`,
  );
  // An effect changes the background and adds graphic layers round the product. The product itself stays true colour
  // unless the person asked to stylise it, and the text is drawn after all of it.
  let groundPng = rasterSvg(ground, W);
  let drawn: Buffer = prod;
  let outline: { png: Buffer; offset: number } | null = null;
  if (spec.effect) {
    const colours = effectColours(p, spec.effectMuted);
    groundPng = await applyBackgroundEffect(groundPng, spec.effect, colours, { cx: cxm, cy: cym, r: Math.max(pw, ph) / 2 }, textRects([...blocks, ...head.blocks], W, u, all.cta));
    outline = await productOutlineLayer(prod, spec.effect, colours, u);
    if (spec.effect.stylise) drawn = await stylisedProduct(prod, spec.effect, colours);
  }
  const rimLayer = await rimOverlay(prod, rim, strength, u);
  const picture = await sharp({ create: { width: W, height: H, channels: 3, background: field } })
    .composite([
      { input: groundPng },
      { input: await renderTextLayer(head.blocks, W, H) }, // the headline goes in first, so the product overlaps it
      ...(outline ? [{ input: outline.png, left: px - outline.offset, top: py - outline.offset }] : []),
      { input: drawn, left: px, top: py },
      ...(rimLayer ? [{ input: rimLayer, left: px, top: py }] : []),
    ])
    .png()
    .toBuffer();
  const finished = await finishImage(picture, { palette: p, strength: spec.finish, seed: py });
  spec.onLayout?.({
    mode: "behind", zoom: 1, gapPx: 0, productGapPx: 0, textTop: Math.round(head.blocks[0].y), textBottom: Math.round(lastTop + shift + ls), productTop: py, productBottom: py + ph,
    productLeft: px, productRight: px + pw, headSize: Math.round(head.size), headlineVisible: fit.visible, headlineBounds: fit.bounds, overlapSteps: fit.steps,
  });
  shapes.push(...(await legibleSmallType(finished, blocks, W, H)));
  return sharp(finished)
    .composite([{ input: rasterSvg(svgWrap(W, H, shapes.join("")), W) }, { input: await renderTextLayer(blocks, W, H) }])
    .png()
    .toBuffer();
}

/** Draws one finished graphic. Returns a PNG at exactly width x height. */
export async function renderDesign(spec: DesignSpec): Promise<Buffer> {
  const p = spec.palette ?? makePalette(spec.brandColours);
  const f = frame(spec.width, spec.height);
  if (spec.archetype === "artwork") return artwork(spec, p, f);
  if (spec.archetype === "product") return product(spec, p, f);
  if (spec.archetype === "behind") return behind(spec, p, f);
  return typographic(spec, p, f);
}

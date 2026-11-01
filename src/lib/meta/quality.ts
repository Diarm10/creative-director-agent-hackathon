// A measured part of the score. The critic is a model and its scores cluster at 7, so the score is moved up or down by what can be measured
// on the finished picture and its layout, with no model call: a product that touches the headline, type that is hard to read, a product that
// is too small, large empty areas. Clean separation and strong contrast earn a point. Pure maths on numbers and a few sampled pixels.
import sharp from "sharp";
import type { LayoutMetrics } from "./design/layouts.js";

export interface Measured {
  delta: number; // added to the critic's score before the caps; between -3 and +1
  faults: string[]; // plain words, one for each measured fault
  goods: string[];
}

export const MIN_CONTRAST = 4.5;
export const STRONG_CONTRAST = 7;
export const SMALL_PRODUCT = 0.35; // of the frame height
export const CLEAR_GAP = 0.03; // of the frame height
export const EMPTY_LIMIT = 0.3; // of the frame height

const lin = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/** The contrast between the dark and the light of a region: the 10th and 90th percentile of its brightness, so text against its ground. */
export async function regionContrast(image: Buffer, box: { left: number; right: number; top: number; bottom: number }): Promise<number | null> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const left = Math.max(0, Math.floor(box.left));
  const top = Math.max(0, Math.floor(box.top));
  const width = Math.min(W - left, Math.ceil(box.right - box.left));
  const height = Math.min(H - top, Math.ceil(box.bottom - box.top));
  if (width < 8 || height < 8) return null;
  const { data, info } = await sharp(image).extract({ left, top, width, height }).resize({ width: Math.min(width, 120), height: Math.min(height, 40), fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ls: number[] = [];
  for (let i = 0; i < data.length; i += info.channels) ls.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  ls.sort((a, b) => a - b);
  const lo = ls[Math.floor(ls.length * 0.1)];
  const hi = ls[Math.floor(ls.length * 0.9)];
  return (hi + 0.05) / (lo + 0.05);
}

/** The numbers: what the layout says about overlap, gap, size and empty space. No pixels needed. */
export function layoutFaults(layout: LayoutMetrics | undefined, frameH: number, masthead: boolean): { delta: number; faults: string[]; clear: boolean } {
  const faults: string[] = [];
  let delta = 0;
  if (!layout) return { delta, faults, clear: false };
  const vis = layout.headlineVisible;
  if (!masthead && vis && vis.length) {
    const worst = Math.min(...vis);
    if (worst < 0.97) { delta -= 2; faults.push("the product covers part of the headline"); }
    else if (worst < 0.999) { delta -= 1; faults.push("the product touches the headline"); }
  }
  const b = layout.headlineBounds;
  let tight = false;
  if (!masthead && b && layout.productTop - b.bottom < CLEAR_GAP * frameH * 0.97 && !faults.length) { delta -= 1; faults.push("the product is too close to the headline"); tight = true; }
  const productH = (layout.productBottom - layout.productTop) / frameH;
  if (productH > 0 && productH < SMALL_PRODUCT) { delta -= 1; faults.push(`the product is only ${Math.round(productH * 100)} percent of the frame height`); }
  // Empty space: the height not used by the type block or the product, less a footer allowance.
  const textH = Math.max(0, layout.textBottom - layout.textTop);
  const covered = textH + Math.max(0, layout.productBottom - layout.productTop) - Math.max(0, layout.textBottom - layout.productTop);
  const empty = (frameH - covered) / frameH - 0.14;
  if (empty > EMPTY_LIMIT) { delta -= 1; faults.push("a large part of the frame is empty"); }
  return { delta, faults, clear: !faults.length && !tight };
}

/** The measured adjustment for one finished ad. */
export async function measureQuality(image: Buffer, layout: LayoutMetrics | undefined, opts: { masthead?: boolean } = {}): Promise<Measured> {
  const meta = await sharp(image).metadata();
  const frameH = meta.height ?? 1080;
  const base = layoutFaults(layout, frameH, !!opts.masthead);
  const faults = [...base.faults];
  const goods: string[] = [];
  let delta = base.delta;
  let strong = false;
  if (layout?.headlineBounds) {
    const c = await regionContrast(image, layout.headlineBounds).catch(() => null);
    if (c !== null) {
      if (c < MIN_CONTRAST) { delta -= 1; faults.push(`the headline is hard to read (contrast ${c.toFixed(1)} to 1, under ${MIN_CONTRAST} to 1)`); }
      else if (c >= STRONG_CONTRAST) strong = true;
    }
  }
  if (base.clear && strong && layout) { delta += 1; goods.push("the product is clear of the headline and the type has strong contrast"); }
  return { delta: Math.max(-3, Math.min(1, delta)), faults, goods };
}

/** The critic's score moved by the measured part, kept between 1 and 10. */
export const adjustScore = (critic: number, delta: number): number => Math.max(1, Math.min(10, Math.round(critic + delta)));

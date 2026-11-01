// Effects: Pop Art, Duotone, Halftone and Neon Outline. Deterministic image maths with sharp and resvg, no model call, and
// the same input always gives the same bytes. Each takes one intensity from 0 to 100; at 0 nothing changes.
//
//   - Effects apply to the BACKGROUND and to GRAPHIC layers (burst, dots, outline) only. The product stays true colour,
//     because a catalogue ad must show the real colour.
//   - "Stylise the product too" is an explicit switch that recolours the product. It is never on by default.
//   - An effect is never applied to text: the layout engine draws the text after every effect, as before.
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";

export * from "../effectInfo.js";
import { clampIntensity, type EffectSpec } from "../effectInfo.js";

export interface EffectColours {
  muted?: boolean; // the restrained Pop Art: no extra saturation, and the burst and dots in a quiet tint
  dark: string;
  light: string;
  accent: string;
  accent2: string;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixHex = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${f(r1, r2)}${f(g1, g2)}${f(b1, b2)}`;
};

const raster = (svg: string, width: number): Buffer => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
const svgWrap = (W: number, H: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;

async function pixels(img: Buffer): Promise<{ data: Buffer; w: number; h: number; c: number }> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}
const fromPixels = (data: Buffer, w: number, h: number): Promise<Buffer> => sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
/** A PNG with its whole alpha scaled by t (sharp's ensureAlpha only sets alpha when there is none). */
async function withOpacity(png: Buffer, t: number): Promise<Buffer> {
  const { width = 1, height = 1 } = await sharp(png).metadata();
  return sharp(png).ensureAlpha().composite([{ input: { create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: Math.max(0, Math.min(1, t)) } } }, blend: "dest-in" }]).png().toBuffer();
}
const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Maps each pixel's brightness onto a line from colour a (dark) to colour b (light), then blends with the original by t. */
async function duotone(img: Buffer, a: string, b: string, t: number, stretch = false): Promise<Buffer> {
  const { data, w, h } = await pixels(img);
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const out = Buffer.from(data);
  // A background is often a soft gradient. Stretching its brightness over the whole range makes the two colours really show.
  let lo = 0;
  let hi = 1;
  if (stretch) {
    lo = 1;
    hi = 0;
    for (let i = 0; i < data.length; i += 4) { const l = lum(data[i], data[i + 1], data[i + 2]); if (l < lo) lo = l; if (l > hi) hi = l; }
    if (hi - lo < 0.02) { lo = Math.max(0, lo - 0.1); hi = Math.min(1, hi + 0.1); }
  }
  for (let i = 0; i < out.length; i += 4) {
    const l = Math.max(0, Math.min(1, (lum(data[i], data[i + 1], data[i + 2]) - lo) / (hi - lo)));
    out[i] = Math.round(data[i] + (ar + (br - ar) * l - data[i]) * t);
    out[i + 1] = Math.round(data[i + 1] + (ag + (bg - ag) * l - data[i + 1]) * t);
    out[i + 2] = Math.round(data[i + 2] + (ab + (bb - ab) * l - data[i + 2]) * t);
  }
  return fromPixels(out, w, h);
}

/** Posterise: each channel to a few flat levels, then more saturation. The alpha channel is left alone. */
async function posterise(img: Buffer, levels: number, saturation: number): Promise<Buffer> {
  const { data, w, h } = await pixels(await sharp(img).modulate({ saturation }).png().toBuffer());
  const out = Buffer.from(data);
  // Flat tones by brightness only: each channel is scaled by the same factor, so a smooth gradient steps in tone and never
  // splits into bands of different hues.
  for (let i = 0; i < out.length; i += 4) {
    const l = lum(data[i], data[i + 1], data[i + 2]);
    const q = Math.round(l * (levels - 1)) / (levels - 1);
    const f = l > 0.002 ? q / l : 1;
    for (let k = 0; k < 3; k++) out[i + k] = Math.max(0, Math.min(255, Math.round(data[i + k] * f)));
  }
  return fromPixels(out, w, h);
}

/** A dot screen over a picture: dots on a grid, bigger where the picture is darker, in one colour. */
async function halftoneLayer(img: Buffer, W: number, H: number, cell: number, colour: string, opacity: number, invert = false): Promise<Buffer> {
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const { data, info } = await sharp(img).removeAlpha().resize({ width: gw, height: gh, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const c = info.channels;
  const dots: string[] = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * c;
      const l = lum(data[i], data[i + 1], data[i + 2]);
      const r = (invert ? l : 1 - l) * cell * 0.62;
      if (r > 0.6) dots.push(`<circle cx="${((x + 0.5) * cell).toFixed(1)}" cy="${((y + 0.5) * cell).toFixed(1)}" r="${r.toFixed(2)}"/>`);
    }
  }
  return raster(svgWrap(W, H, `<g fill="${colour}" fill-opacity="${opacity.toFixed(3)}">${dots.join("")}</g>`), W);
}

/**
 * The burst sits behind the product and to one side of it, on the side with more room, and is smaller than a ring would be, so
 * it never goes all the way round the product like a frame or a box.
 */
export function popBurst(anchor: Anchor, _W: number): { cx: number; cy: number; r: number } {
  return { cx: anchor.cx, cy: anchor.cy, r: anchor.r * 1.45 };
}

const wcag = (hex: string): number => {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: string, b: string): number => { const x = wcag(a); const y = wcag(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** The burst colour: of the palette's colours, the one that stands out most from the ground, never a muddy mid tone that sinks into it. */
export function burstColour(ground: string, colours: Pick<EffectColours, "accent" | "accent2" | "light" | "dark">): string {
  const candidates = [colours.accent2, colours.accent, colours.light, colours.dark];
  const best = candidates.reduce((a, c) => (ratio(c, ground) > ratio(a, ground) ? c : a), candidates[0]);
  if (ratio(best, ground) >= 3) return best;
  return wcag(ground) > 0.4 ? "#1B1B1B" : "#FFE066";
}

/** How big a Pop Art dot is, as a share of a full dot, at this distance from the product's centre: full at its edge, fading outward. */
export function popDotScale(distance: number, anchorR: number, W: number): number {
  if (distance <= anchorR) return 1;
  const reach = W * 0.55;
  return Math.max(0.18, 1 - (distance - anchorR) / reach);
}

/** Halftone dots on a grid, largest near the product's edges and shrinking outward. Deterministic. */
function popDots(W: number, H: number, cell: number, colour: string, opacity: number, anchor: Anchor): Buffer {
  const dots: string[] = [];
  const maxR = cell * 0.5;
  for (let y = 0; y * cell < H + cell; y++) {
    for (let x = 0; x * cell < W + cell; x++) {
      // Every other row is shifted by half a cell, the way a printed screen is.
      const cx = (x + 0.5 + (y % 2 ? 0.5 : 0)) * cell;
      const cy = (y + 0.5) * cell;
      const r = maxR * popDotScale(Math.hypot(cx - anchor.cx, cy - anchor.cy), anchor.r, W);
      if (r > 1) dots.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(2)}"/>`);
    }
  }
  return raster(svgWrap(W, H, `<g fill="${colour}" fill-opacity="${opacity.toFixed(3)}">${dots.join("")}</g>`), W);
}

/** A starburst: alternating long and short rays round a centre. */
function burstSvg(cx: number, cy: number, r: number, rays: number, fill: string, opacity: number): string {
  const pts: string[] = [];
  for (let i = 0; i < rays * 2; i++) {
    const a = (Math.PI * i) / rays - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.66;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" fill-opacity="${opacity.toFixed(3)}"/>`;
}

/** A box the effect must leave alone: where text is drawn, in canvas pixels. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Restores the plain background inside each box, so burst shapes and dots never run under text. */
async function keepClear(result: Buffer, plain: Buffer, avoid: readonly Rect[], W: number, H: number): Promise<Buffer> {
  const patches: { input: Buffer; left: number; top: number }[] = [];
  for (const r of avoid) {
    const left = Math.max(0, Math.floor(r.left));
    const top = Math.max(0, Math.floor(r.top));
    const width = Math.min(W - left, Math.ceil(r.width));
    const height = Math.min(H - top, Math.ceil(r.height));
    if (width < 2 || height < 2) continue;
    patches.push({ input: await sharp(plain).extract({ left, top, width, height }).png().toBuffer(), left, top });
  }
  return patches.length ? sharp(result).composite(patches).png().toBuffer() : result;
}

export interface Anchor {
  cx: number; // where the product is: the burst and the glow centre on it
  cy: number;
  r: number; // about half the product's longer side
}

/**
 * The background with the effect applied. `ground` is the finished background without the product or any text.
 * Returns a PNG of the same size.
 */
export async function applyBackgroundEffect(ground: Buffer, effect: EffectSpec, colours: EffectColours, anchor: Anchor, avoid: readonly Rect[] = []): Promise<Buffer> {
  const t = clampIntensity(effect.intensity) / 100;
  if (t === 0) return ground;
  const { width: W = 0, height: H = 0 } = await sharp(ground).metadata();
  const u = W / 1080;
  switch (effect.id) {
    case "duotone":
      // Deep tinted dark to a light tint of the accent, over the whole range of the ground, and at least three quarters strength.
      return duotone(ground, mixHex(colours.dark, colours.accent, 0.3), mixHex(colours.accent, colours.light, 0.55), Math.max(t, 0.75), true);
    case "halftone": {
      // A light paper tone with the picture printed as dots over it.
      const paper = mixHex(colours.light, colours.dark, 0.04);
      const dots = await halftoneLayer(ground, W, H, Math.max(10, Math.round(22 * u)), mixHex(colours.dark, colours.accent, 0.35), 0.9 * t);
      const base = await sharp({ create: { width: W, height: H, channels: 3, background: paper } }).png().toBuffer();
      const printed = await sharp(base).composite([{ input: dots }]).png().toBuffer();
      const out = await sharp(ground).composite([{ input: await withOpacity(printed, t) }]).png().toBuffer();
      return keepClear(out, await sharp(ground).composite([{ input: await withOpacity(base, t) }]).png().toBuffer(), avoid, W, H);
    }
    case "neon": {
      // A dark ground, with a faint glow where the product is. The line round the product is the outline layer.
      const night = mixHex(colours.dark, "#000000", 0.55);
      const glow = svgWrap(W, H, `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${anchor.r * 0.5}"/></filter></defs><rect width="${W}" height="${H}" fill="${night}"/><circle cx="${anchor.cx}" cy="${anchor.cy}" r="${anchor.r * 0.9}" fill="${colours.accent}" fill-opacity="0.35" filter="url(#b)"/>`);
      return sharp(ground).composite([{ input: await withOpacity(raster(glow, W), Math.min(1, t * 1.15)) }]).png().toBuffer();
    }
    case "popart": {
      // The muted version keeps many levels: few levels would split a dark gradient into bands of odd colours.
      const levels = colours.muted ? 24 : Math.max(5, Math.round(9 - 4 * t));
      const flat = await posterise(ground, levels, colours.muted ? 1 : 1 + 0.7 * t);
      const b = popBurst(anchor, W);
      const mean = await sharp(flat).removeAlpha().resize(1, 1, { fit: "fill" }).raw().toBuffer();
      const groundHex = "#" + [mean[0], mean[1], mean[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      const burst = svgWrap(W, H, burstSvg(b.cx, b.cy, b.r, 14, burstColour(groundHex, colours), (colours.muted ? 0.55 : 0.95) * t));
      const withBurst = await sharp(flat).composite([{ input: raster(burst, W) }]).png().toBuffer();
      const dots = popDots(W, H, Math.max(14, Math.round(30 * u)), mixHex(colours.dark, colours.accent, 0.25), (colours.muted ? 0.28 : 0.5) * t, anchor);
      const popped = await sharp(withBurst).composite([{ input: dots }]).png().toBuffer();
      return keepClear(popped, flat, avoid, W, H);
    }
  }
}

/** Dilates a cut-out's silhouette by radius px: the alpha, blurred and thresholded. Returns the mask at the padded size. */
async function dilatedMask(prod: Buffer, radius: number): Promise<{ mask: Buffer; pad: number; w: number; h: number }> {
  const pad = Math.ceil(radius * 3);
  const m = await sharp(prod).metadata();
  const w = (m.width ?? 1) + 2 * pad;
  const h = (m.height ?? 1) + 2 * pad;
  const alpha = await sharp(prod).ensureAlpha().extractChannel(3).png().toBuffer();
  const padded = await sharp({ create: { width: w, height: h, channels: 3, background: "#000000" } })
    .composite([{ input: await sharp(alpha).toColourspace("b-w").png().toBuffer(), left: pad, top: pad }])
    .greyscale()
    .png()
    .toBuffer();
  // Two steps: sharp applies threshold before blur inside one pipeline, which left the mask undilated.
  const blurred = await sharp(padded).blur(Math.max(0.3, radius / 2.4)).png().toBuffer();
  const mask = await sharp(blurred).threshold(10).png().toBuffer();
  return { mask, pad, w, h };
}

const coloured = async (mask: Buffer, w: number, h: number, colour: string): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: colour } }).joinChannel(await sharp(mask).greyscale().raw().toBuffer(), { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();

/**
 * The graphic layer drawn UNDER the product: a glowing line for Neon Outline. Pop Art draws no outline (a line round the product was read as a halo). It is a
 * graphic layer round the product, so the product itself stays true colour. Null for effects with no outline.
 * The layer is returned with the offset to draw it at, relative to the product's top left.
 */
export async function productOutlineLayer(prod: Buffer, effect: EffectSpec, colours: EffectColours, u: number): Promise<{ png: Buffer; offset: number } | null> {
  const t = clampIntensity(effect.intensity) / 100;
  if (t === 0 || effect.id !== "neon") return null;
  const radius = Math.max(2, Math.round(7 * u));
  const { mask, pad, w, h } = await dilatedMask(prod, radius);
  const line = await coloured(mask, w, h, colours.accent2);
  const glow = await sharp(line).blur(Math.max(3, 14 * u * t)).png().toBuffer();
  const out = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await withOpacity(glow, 0.9 * t) }, { input: await withOpacity(line, Math.min(1, 0.4 + t)) }])
    .png()
    .toBuffer();
  return { png: out, offset: pad };
}

/**
 * The white border of a sticker: the product's silhouette grown by radius px and filled solid white, drawn under the product.
 * It is a graphic layer, so the product keeps its true colour. Returned with the offset to draw it at.
 */
export async function stickerBorder(prod: Buffer, radius: number): Promise<{ png: Buffer; offset: number }> {
  const { mask, pad, w, h } = await dilatedMask(prod, radius);
  return { png: await coloured(mask, w, h, "#FFFFFF"), offset: pad };
}

/**
 * Recolours the product itself. Only used when the person turned "Stylise the product too" on. The shape and the alpha are
 * untouched; only the colour changes.
 */
export async function stylisedProduct(prod: Buffer, effect: EffectSpec, colours: EffectColours): Promise<Buffer> {
  const t = clampIntensity(effect.intensity) / 100;
  if (t === 0) return prod;
  const { data, w, h } = await pixels(prod);
  const keepAlpha = (recoloured: Buffer): Promise<Buffer> => {
    const out = Buffer.from(recoloured);
    for (let i = 3; i < out.length; i += 4) out[i] = data[i];
    return fromPixels(out, w, h);
  };
  switch (effect.id) {
    case "duotone":
      return keepAlpha((await pixels(await duotone(prod, colours.dark, mixHex(colours.accent, colours.light, 0.35), t))).data);
    case "popart":
      return keepAlpha((await pixels(await posterise(prod, Math.max(3, Math.round(8 - 5 * t)), 1 + 0.7 * t))).data);
    case "halftone":
      return keepAlpha((await pixels(await duotone(prod, colours.dark, colours.light, t))).data);
    case "neon":
      return keepAlpha((await pixels(await duotone(prod, "#05050F", colours.accent2, t))).data);
  }
}

/** The colours an effect needs, from a layout palette. */
export const effectColours = (p: { dark: string; light: string; accents: readonly [string, string] }, muted = false): EffectColours => ({ dark: p.dark, light: p.light, accent: p.accents[0], accent2: p.accents[1], muted });

/** How far the outline layer reaches round the product, in px, for an effect. 0 when it draws none. */
export function outlineRadius(effect: EffectSpec | undefined, u: number): number {
  if (!effect) return 0;
  const t = clampIntensity(effect.intensity) / 100;
  if (t === 0) return 0;
  if (effect.id === "neon") return Math.max(2, Math.round(7 * u));
  return 0;
}

/**
 * The silhouette the outline layer adds to the product, as a padded alpha (one byte a pixel). The overlap guard measures with
 * it, so a thick outline cannot cover the headline more than the guard allows.
 */
export async function outlineMask(prod: Buffer, radius: number): Promise<{ alpha: Buffer; w: number; h: number; pad: number }> {
  const { mask, pad, w, h } = await dilatedMask(prod, radius);
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * info.channels];
  return { alpha, w, h, pad };
}

/**
 * The tone an effect needs the background to have, so the type drawn over it stays readable: Neon Outline is a dark ground,
 * Halftone a light paper. Null when the effect leaves the layout's own choice alone.
 */
export function effectGround(effect: EffectSpec | undefined): "dark" | "light" | null {
  if (!effect || clampIntensity(effect.intensity) === 0) return null;
  return effect.id === "neon" ? "dark" : effect.id === "halftone" ? "light" : null;
}

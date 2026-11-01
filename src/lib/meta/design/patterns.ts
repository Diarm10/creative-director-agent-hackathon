// NEW FOR HACKATHON. Procedural background patterns as SVG strings, drawn in the brand palette.
// Fine lines and right angles, flat colour, no gradients or blur, so they stay crisp at any size.
// Seeded: the same seed gives the same pattern, a different seed gives a different composition.
import { mix, type Palette } from "./palette.js";

export type PatternKind = "diagonals" | "grid" | "arcs" | "bars";
export const PATTERN_KINDS: readonly PatternKind[] = ["diagonals", "grid", "arcs", "bars"];

/** Small deterministic PRNG so patterns are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Band {
  y0: number;
  y1: number;
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/**
 * Wraps the bright, emphasised elements so they only draw inside the given horizontal bands.
 * No bands means the whole canvas. Used to keep accent lines from crossing the headline.
 */
function emphasis(w: number, parts: string[], bands?: readonly Band[]): string {
  if (!bands) return parts.join("");
  if (bands.length === 0) return "";
  const rects = bands.map((b) => `<rect x="0" y="${b.y0.toFixed(1)}" width="${w}" height="${Math.max(0, b.y1 - b.y0).toFixed(1)}"/>`).join("");
  return `<clipPath id="em">${rects}</clipPath><g clip-path="url(#em)">${parts.join("")}</g>`;
}

/** Parallel 45 degree lines in bands of different colours, plus a few right-angle step lines. */
function diagonals(w: number, h: number, p: Palette, onDark: boolean, rand: () => number, bands?: readonly Band[]): string {
  const u = w / 1080;
  const gap = 26 * u;
  const stroke = 2 * u;
  const quiet = mix(p.dark, p.light, onDark ? 0.22 : 0.3);
  const palette = [p.accents[0], p.accents[1], quiet, quiet];
  const parts: string[] = [];
  const total = Math.ceil((w + h) / gap);
  let band = 0;
  let left = 3 + Math.floor(rand() * 5);
  for (let i = 0; i < total; i++) {
    if (left-- <= 0) {
      band = (band + 1 + Math.floor(rand() * 2)) % palette.length;
      left = 3 + Math.floor(rand() * 6);
    }
    const x = i * gap - h;
    parts.push(`<line x1="${x.toFixed(1)}" y1="${h}" x2="${(x + h).toFixed(1)}" y2="0" stroke="${palette[band]}" stroke-width="${stroke}"/>`);
  }
  // Right-angle step lines: deliberate geometry, not noise.
  const step = 64 * u;
  const steps: string[] = [];
  for (let s = 0; s < 3; s++) {
    let x = rand() * w * 0.8;
    let y = h * (0.15 + rand() * 0.75);
    const pts = [`${x.toFixed(1)},${y.toFixed(1)}`];
    const n = 5 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      x += step * (0.8 + rand() * 0.8);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      y -= step * (0.8 + rand() * 0.8);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    steps.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${p.accents[s % 2]}" stroke-width="${stroke * 1.6}" stroke-linejoin="miter"/>`);
  }
  return svg(w, h, parts.join("") + emphasis(w, steps, bands));
}

/** A fine orthogonal grid with a few emphasised lines and corner brackets. */
function grid(w: number, h: number, p: Palette, onDark: boolean, rand: () => number, bands?: readonly Band[]): string {
  const u = w / 1080;
  const cell = 54 * u;
  const faint = mix(p.dark, p.light, onDark ? 0.14 : 0.18);
  const parts: string[] = [];
  for (let x = 0; x <= w; x += cell) parts.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${h}" stroke="${faint}" stroke-width="${1.5 * u}"/>`);
  for (let y = 0; y <= h; y += cell) parts.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="${faint}" stroke-width="${1.5 * u}"/>`);
  // One accent ruler line and a few filled squares on grid intersections: deliberate marks, not stubs.
  const bright: string[] = [];
  const gy = Math.round(rand() * (h / cell - 2) + 1) * cell;
  bright.push(`<rect x="0" y="${(gy - 1.5 * u).toFixed(1)}" width="${w}" height="${3 * u}" fill="${p.accents[1]}"/>`);
  // Squares sit ON the ruler line, like markers on a scale, never floating on their own.
  for (let k = 0; k < 3; k++) {
    const gx = Math.round(rand() * (w / cell - 2) + 1) * cell;
    bright.push(`<rect x="${gx.toFixed(1)}" y="${(gy - cell / 2).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${p.accents[k % 2]}"/>`);
  }
  return svg(w, h, parts.join("") + emphasis(w, bright, bands));
}

/** Concentric quarter rings out of one corner, alternating accent colours. */
function arcs(w: number, h: number, p: Palette, onDark: boolean, rand: () => number, bands?: readonly Band[]): string {
  const u = w / 1080;
  const corner = rand() < 0.5 ? "br" : "tr";
  const cx = w;
  const cy = corner === "br" ? h : 0;
  const quiet = mix(p.dark, p.light, onDark ? 0.2 : 0.28);
  const parts: string[] = [];
  const bright: string[] = [];
  const rings = 16;
  const gap = (Math.max(w, h) * 0.95) / rings;
  for (let i = 1; i <= rings; i++) {
    const colour = i % 5 === 0 ? p.accents[0] : i % 7 === 0 ? p.accents[1] : quiet;
    const ring = `<circle cx="${cx}" cy="${cy}" r="${(i * gap).toFixed(1)}" fill="none" stroke="${colour}" stroke-width="${(i % 5 === 0 || i % 7 === 0 ? 3 : 2) * u}"/>`;
    (colour === quiet ? parts : bright).push(ring);
  }
  return svg(w, h, parts.join("") + emphasis(w, bright, bands));
}

/** A flat skyline of vertical bars rising from the foot, a few outlined in accent colours. */
function bars(w: number, h: number, p: Palette, onDark: boolean, rand: () => number, bands?: readonly Band[]): string {
  const u = w / 1080;
  const colW = 54 * u;
  const n = Math.ceil(w / colW);
  const quiet = mix(p.dark, p.light, onDark ? 0.13 : 0.16);
  const parts: string[] = [];
  const bright: string[] = [];
  for (let i = 0; i < n; i++) {
    const bh = h * (0.12 + rand() * 0.5);
    const x = i * colW;
    parts.push(`<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(colW - 6 * u).toFixed(1)}" height="${bh.toFixed(1)}" fill="${quiet}"/>`);
    if (rand() < 0.2) {
      bright.push(`<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(colW - 6 * u).toFixed(1)}" height="${bh.toFixed(1)}" fill="${mix(p.dark, p.accents[bright.length % 2], 0.5)}"/>`);
    }
  }
  return svg(w, h, parts.join("") + emphasis(w, bright, bands));
}

export function patternSvg(kind: PatternKind, w: number, h: number, p: Palette, onDark: boolean, seed: number, bands?: readonly Band[]): string {
  const rand = rng(seed);
  if (kind === "grid") return grid(w, h, p, onDark, rand, bands);
  if (kind === "arcs") return arcs(w, h, p, onDark, rand, bands);
  if (kind === "bars") return bars(w, h, p, onDark, rand, bands);
  return diagonals(w, h, p, onDark, rand, bands);
}

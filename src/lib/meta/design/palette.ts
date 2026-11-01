// NEW FOR HACKATHON. Turns a folio's brand colours (or nothing) into a small, strict palette the
// layout engine can rely on: one dark, one light, two accents. Two or three colours per design.

export interface Palette {
  dark: string; // darkest colour, used as a background or as text on light
  light: string; // lightest colour, used as a background or as text on dark
  accents: [string, string]; // thin lines, rules, highlights
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// Used when a folio gives too few colours: near-black navy with blue, green and orange, the same
// restrained mix as the sticker reference.
const DEFAULT: Palette = { dark: "#0B1220", light: "#F3F1EC", accents: ["#4D8DF5", "#2FBF8F"] };
const DEFAULT_THIRD = "#F2884B";

export function normaliseHex(c: string): string | null {
  const t = c.trim();
  if (!HEX.test(t)) return null;
  if (t.length === 4) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toUpperCase();
  return t.toUpperCase();
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Brand colours in, palette out. Invalid entries (like "navy") are ignored. */
export function makePalette(colours: readonly string[] | undefined): Palette {
  const valid = [...new Set((colours ?? []).map(normaliseHex).filter((c): c is string => !!c))];
  if (valid.length === 0) return { ...DEFAULT, accents: [...DEFAULT.accents] as [string, string] };

  const byLum = [...valid].sort((a, b) => luminance(a) - luminance(b));
  let dark = byLum[0];
  let light = byLum[byLum.length - 1];
  // Too little separation means a one-colour brand: pair it with a neutral.
  if (valid.length === 1 || contrast(dark, light) < 4.5) {
    if (luminance(dark) < 0.25) light = DEFAULT.light;
    else {
      light = dark;
      dark = DEFAULT.dark;
    }
  }
  const rest = valid.filter((c) => c !== dark && c !== light).sort((a, b) => saturation(b) - saturation(a));
  // A saturated brand colour that is neither dark nor light is the best accent; a saturated "dark"
  // (deep green) can serve as an accent too.
  const pool = [...rest, ...[dark, light].filter((c) => saturation(c) > 0.35 && contrast(c, dark) > 1.2 && contrast(c, light) > 1.2)];
  const fallback = [DEFAULT.accents[0], DEFAULT.accents[1], DEFAULT_THIRD];
  const unique = [...new Set(pool)];
  // A brand with one accent keeps that one accent for both slots; generic colours are only for brands with none.
  const accents: [string, string] =
    unique.length >= 2 ? [unique[0], unique[1]] : unique.length === 1 ? [unique[0], unique[0]] : ([...fallback].slice(0, 2) as [string, string]);
  return { dark, light, accents };
}

/** Readable text colour on a given background, from the palette. */
export function textOn(bg: string, p: Palette): string {
  return contrast(bg, p.light) >= contrast(bg, p.dark) ? p.light : p.dark;
}

/** A mix of two colours, t from 0 (a) to 1 (b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const h = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${h(ar, br)}${h(ag, bg)}${h(ab, bb)}`.toUpperCase();
}

/** The first accent that stays readable on the given background, otherwise plain text colour. */
export function legibleAccent(bg: string, p: Palette): string {
  return [p.accents[0], p.accents[1]].find((c) => contrast(c, bg) >= 4.5) ?? textOn(bg, p);
}

// The Pop Art palette comes from the product itself: its dominant colours, plus one neutral and one accent chosen to contrast with
// them. A product that is itself neutral (white, black, grey, beige) gets a restrained two-tone version in a muted tint, so a plain
// white mug is never put on a loud comic palette. Deterministic image maths, no model call.
import sharp from "sharp";

export interface ProductColours {
  dominant: string[]; // up to three, most common first, as hex
  mean: string; // the average colour of the product
  saturation: number; // average saturation of the product, 0 to 1
  neutral: boolean; // mostly white, black, grey or beige
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** The dominant colours of a cut-out, from its opaque pixels. */
export async function productColours(png: Buffer): Promise<ProductColours> {
  const { data, info } = await sharp(png).ensureAlpha().resize({ width: 64, height: 64, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let n = 0, sr = 0, sg = 0, sb = 0, sat = 0, neutralN = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    n++; sr += r; sg += g; sb += b;
    const [, s, l] = toHsl(r, g, b);
    sat += s;
    const pale = s < 0.45 && l > 0.6 && toHsl(r, g, b)[0] >= 15 && toHsl(r, g, b)[0] <= 60; // beige and cream
    if (s < 0.2 || l < 0.12 || l > 0.9 || pale) neutralN++;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
  }
  if (n === 0) return { dominant: [], mean: "#808080", saturation: 0, neutral: true };
  const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((k) => hex(k.r / k.n, k.g / k.n, k.b / k.n));
  return { dominant: top, mean: hex(sr / n, sg / n, sb / n), saturation: sat / n, neutral: neutralN / n >= 0.7 };
}

export interface PopPalette {
  colours: string[]; // for makePalette: a dark, a light and two accents
  muted: boolean; // the restrained version: the effect draws its burst and dots in a muted tint
}

/**
 * Chromatic product: its own most colourful dominant colour, the opposite hue as the accent, and a dark and a light neutral.
 * Neutral product: a restrained two-tone, a dark and a light neutral with one muted tint taken from the product's own cast.
 */
export function popPalette(pc: ProductColours): PopPalette {
  const dark = "#1A1D21";
  const light = "#F4F1EA";
  if (pc.neutral) {
    const [h, s] = toHsl(...(pc.mean.match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16)) as [number, number, number]));
    // The tint keeps the product's own cast (warm for beige, cool for grey and white) but stays quiet.
    const warm = h >= 20 && h <= 60 && s > 0.08;
    const tint = warm ? "#B9A48A" : "#9AA7B2";
    return { colours: [dark, light, tint, warm ? "#8F7C65" : "#6F7C88"], muted: true };
  }
  const colourful = pc.dominant
    .map((c) => ({ c, hsl: toHsl(...(c.match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16)) as [number, number, number])) }))
    .filter((x) => x.hsl[1] >= 0.25 && x.hsl[2] > 0.12 && x.hsl[2] < 0.9)
    .sort((a, b) => b.hsl[1] - a.hsl[1])[0];
  // A dark or dull product (a dark green plant) has no colourful bucket: keep the hue of its most common colour anyway.
  const lead = toHsl(...(pc.dominant[0].match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16)) as [number, number, number]));
  const [h, s, l] = colourful ? colourful.hsl : lead[1] >= 0.12 ? [lead[0], 0.55, 0.45] : [30, 0.5, 0.5];
  const own = fromHsl(h, Math.min(0.85, Math.max(0.45, s)), Math.min(0.58, Math.max(0.42, l)));
  const opposite = fromHsl((h + 180) % 360, 0.7, 0.55);
  return { colours: [dark, light, own, opposite], muted: false };
}

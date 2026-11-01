// The finishing pass: one last image stage applied to the picture of every finished design, before the type is drawn
// on it, so the text stays crisp. Deterministic and cheap: no model call, and the same input gives the same bytes.
//
//   colour grade   shadows lean towards the palette's dark colour, highlights lean slightly warm, with a touch of S curve
//   local contrast the picture minus a wide blur of itself, capped, so structure lifts without haloing edges
//   vignette       a soft darkening towards the corners
//   grain          fine film grain, strongest in the mid tones, none that muddies pure black or white
//
// Strength is one number. 0 turns the pass off; 1 is the strongest setting that still looks tasteful.
import sharp from "sharp";
import type { Palette } from "./palette.js";
import { rng } from "./patterns.js";

/** The default strength, tuned by eye on the poster, the product scene and the product on a colour field. */
export const FINISH_STRENGTH = 0.8;

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface FinishOptions {
  palette: Palette;
  strength?: number; // 0 to 1, defaults to FINISH_STRENGTH
  seed?: number; // the grain pattern
  localContrast?: number; // 0 for flat designs and cut-outs (it would put a halo round every edge), a little for photographs
}

/** Grades, vignettes and grains a picture. Returns a PNG of the same size. */
export async function finishImage(image: Buffer, opts: FinishOptions): Promise<Buffer> {
  const s = Math.max(0, Math.min(1, opts.strength ?? FINISH_STRENGTH));
  if (s === 0) return image;

  // Local contrast: the picture minus a wide blur of itself, added back with a cap so strong edges never get a halo.
  const base = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = base;
  const { width: W, height: H, channels: C } = info;
  const LOCAL = (opts.localContrast ?? 0) * s;
  const CAP = 16;
  const blurred = LOCAL > 0 ? await sharp(data, { raw: { width: W, height: H, channels: C } }).blur(Math.max(8, W / 45)).raw().toBuffer() : data;
  const dark = hexToRgb(opts.palette.dark);
  const rand = rng((opts.seed ?? 5) * 7919 + W);
  let lumSum = 0;
  for (let i = 0; i < data.length; i += C * 97) lumSum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  const avgLum = lumSum / Math.ceil(data.length / (C * 97));
  const vignetteAmount = Math.max(0.1, Math.min(0.3, 0.34 - 0.3 * avgLum)); // 0.3 on a dark picture, about 0.15 on a light one
  const cx = W / 2;
  const cy = H / 2;
  const out = Buffer.alloc(W * H * 3);

  for (let y = 0; y < H; y++) {
    const dy = (y - cy) / cy;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const o = (y * W + x) * 3;
      const d = (c: number) => Math.max(-CAP, Math.min(CAP, data[i + c] - blurred[i + c])) * LOCAL;
      let r = data[i] + d(0);
      let g = data[i + 1] + d(1);
      let b = data[i + 2] + d(2);
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      // Shadows towards the dark brand colour (deep shadows most), highlights a little warm.
      const sw = Math.pow(Math.max(0, 1 - l * 1.7), 1.5);
      const hw = Math.pow(Math.max(0, l * 1.25 - 0.25), 2);
      const pull = sw * 0.3 * s;
      r += (dark[0] - r) * pull + 7 * hw * s;
      g += (dark[1] - g) * pull + 2 * hw * s;
      b += (dark[2] - b) * pull - 8 * hw * s;

      // A touch of S curve, so the picture is a little deeper without clipping.
      const k = 0.07 * s;
      r = 127.5 + (r - 127.5) * (1 + k);
      g = 127.5 + (g - 127.5) * (1 + k);
      b = 127.5 + (b - 127.5) * (1 + k);

      // Vignette: soft, only in the outer part of the frame.
      const dx = (x - cx) / cx;
      const v = 1 - vignetteAmount * s * smooth(0.55, 1.35, Math.hypot(dx, dy));
      r *= v;
      g *= v;
      b *= v;

      // Fine grain, weighted to the mid tones, the same on all channels so it reads as film and not colour noise.
      const mid = 1 - Math.abs(l - 0.5) * 1.4;
      const n = (rand() - 0.5) * 2 * 8.5 * s * Math.max(0, mid);
      out[o] = Math.max(0, Math.min(255, r + n));
      out[o + 1] = Math.max(0, Math.min(255, g + n));
      out[o + 2] = Math.max(0, Math.min(255, b + n));
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

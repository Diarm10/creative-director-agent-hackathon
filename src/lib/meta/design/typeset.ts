// NEW FOR HACKATHON. Typesetting for the layout engine: font loading, real glyph measurement and
// headline fitting, and the text layer renderer. satori turns text into vector paths, resvg
// rasterises them, so the typography is drawn by us, never by the image model.
//
// Fonts: Barlow Condensed (headlines) and Inter (everything else), both SIL OFL, committed under
// assets/fonts/. Georgia, Arial, Times New Roman and Verdana are proprietary and not bundled.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type FontKey = "display" | "display-semi" | "body" | "body-bold";

const FILES: Record<FontKey, { file: string; name: string; weight: 400 | 600 | 700 }> = {
  display: { file: "barlow-condensed-latin-700-normal.woff2", name: "Barlow Condensed", weight: 700 },
  "display-semi": { file: "barlow-condensed-latin-600-normal.woff2", name: "Barlow Condensed", weight: 600 },
  body: { file: "inter-latin-400-normal.woff2", name: "Inter", weight: 400 },
  "body-bold": { file: "inter-latin-700-normal.woff2", name: "Inter", weight: 700 },
};

function fontDir(): string {
  const besideRepo = fileURLToPath(new URL("../../../../assets/fonts/", import.meta.url));
  return existsSync(besideRepo) ? besideRepo : join(process.cwd(), "assets", "fonts");
}

let fontCache: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;
export function loadFonts() {
  if (!fontCache) {
    const dir = fontDir();
    fontCache = (Object.keys(FILES) as FontKey[]).map((k) => ({
      name: FILES[k].name,
      data: readFileSync(join(dir, FILES[k].file)),
      weight: FILES[k].weight,
      style: "normal" as const,
    }));
  }
  return fontCache;
}

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  width: number; // box width, used for alignment
  size: number;
  font: FontKey;
  color: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number; // in px
  uppercase?: boolean;
}

interface Node {
  type: string;
  props: { style: Record<string, unknown>; children?: string | Node[] };
}

function blockNode(b: TextBlock): Node {
  const f = FILES[b.font];
  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: b.x,
        top: b.y,
        width: b.width,
        display: "flex",
        justifyContent: b.align === "center" ? "center" : b.align === "right" ? "flex-end" : "flex-start",
        fontFamily: f.name,
        fontWeight: f.weight,
        fontSize: b.size,
        lineHeight: b.lineHeight ?? 1,
        letterSpacing: b.letterSpacing ?? 0,
        color: b.color,
        whiteSpace: "nowrap",
      },
      children: b.uppercase ? b.text.toUpperCase() : b.text,
    },
  };
}

/** Renders text blocks to a transparent PNG the size of the canvas. */
export async function renderTextLayer(blocks: TextBlock[], width: number, height: number): Promise<Buffer> {
  const tree: Node = {
    type: "div",
    props: { style: { position: "relative", display: "flex", width, height }, children: blocks.map(blockNode) },
  };
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width, height, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}

const widthCache = new Map<string, number>();

/**
 * Width of a line at 100px, built from single-word measurements plus one measured space, so a
 * headline with many possible line breaks costs one render per word, not one per candidate line.
 * Within about 1% of measuring the whole line directly (see tests/unit/design-engine.test.mjs).
 */
export async function lineWidth100(line: string, font: FontKey, uppercase: boolean, ls: number): Promise<number> {
  const words = line.split(/s+/).filter(Boolean);
  if (words.length <= 1) return measure100(line, font, uppercase, ls);
  const [i1, i2] = await Promise.all([measure100("I", font, uppercase, ls), measure100("I I", font, uppercase, ls)]);
  const space = i2 - 2 * i1;
  const widths = await Promise.all(words.map((w) => measure100(w, font, uppercase, ls)));
  return widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
}

/** Ink width of a line of text at 100px, measured by rendering it. Width scales linearly with size. */
export async function measure100(text: string, font: FontKey, uppercase: boolean, letterSpacingEm = 0): Promise<number> {
  const key = `${font}|${uppercase}|${letterSpacingEm}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const size = 100;
  const W = Math.max(300, Math.ceil(text.length * 75) + 60);
  const png = await renderTextLayer(
    [{ text, x: 20, y: 20, width: W - 40, size, font, color: "#000000", uppercase, letterSpacing: letterSpacingEm * size }],
    W,
    size * 1.6,
  );
  const { info } = await sharp(png).trim({ threshold: 5 }).toBuffer({ resolveWithObject: true });
  // Ink width plus the trailing letter-spacing that trim cannot see keeps measurements honest.
  widthCache.set(key, info.width);
  return info.width;
}

export interface FittedHeadline {
  lines: string[];
  size: number;
}

/** All ways to split words into 1..maxLines consecutive lines. */
function partitions(words: string[], maxLines: number): string[][] {
  const out: string[][] = [];
  const n = words.length;
  const walk = (start: number, acc: string[]) => {
    if (start === n) { out.push(acc); return; }
    if (acc.length === maxLines) return;
    for (let end = start + 1; end <= n; end++) walk(end, [...acc, words.slice(start, end).join(" ")]);
  };
  walk(0, []);
  return out;
}

/**
 * Picks the line breaks and font size that make a headline as large as the box allows. Real
 * measurement, so a long word cannot overflow and a short title becomes big.
 */
export async function fitHeadline(opts: {
  text: string;
  maxWidth: number;
  maxHeight: number;
  maxLines: number;
  lineHeight: number;
  maxSize: number;
  font?: FontKey;
  uppercase?: boolean;
  letterSpacingEm?: number;
}): Promise<FittedHeadline> {
  const font = opts.font ?? "display";
  const uppercase = opts.uppercase ?? true;
  const ls = opts.letterSpacingEm ?? 0.01;
  const words = opts.text.trim().split(/\s+/).filter(Boolean).slice(0, 12);
  if (words.length === 0) return { lines: [], size: opts.maxSize };
  let best: { lines: string[]; size: number; balance: number } | null = null;
  for (const lines of partitions(words, opts.maxLines)) {
    const widths = await Promise.all(lines.map((l) => lineWidth100(l, font, uppercase, ls)));
    const widest = Math.max(...widths);
    const size = Math.min((100 * opts.maxWidth) / widest, opts.maxHeight / (lines.length * opts.lineHeight), opts.maxSize);
    const balance = widest - Math.min(...widths);
    if (!best || size > best.size * 1.04 || (size >= best.size * 0.96 && balance < best.balance)) {
      best = { lines, size, balance };
    }
  }
  // Ranking used summed word widths; verify the winner against the real width of each line.
  const real = await Promise.all(best!.lines.map((l) => measure100(l, font, uppercase, ls)));
  const size = Math.min(best!.size, (100 * opts.maxWidth) / Math.max(...real));
  return { lines: best!.lines, size: Math.floor(size) };
}

/** Shrinks a single line of text until it fits the width, never above maxSize. */
export async function fitLine(text: string, maxWidth: number, maxSize: number, font: FontKey, uppercase = false, ls = 0): Promise<number> {
  const w100 = await measure100(text, font, uppercase, ls);
  return Math.floor(Math.min(maxSize, (100 * maxWidth) / w100));
}

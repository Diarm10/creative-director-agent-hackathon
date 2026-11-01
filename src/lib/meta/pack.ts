// The campaign pack: the chosen design at square, story and poster sizes, plus the copy, in one ZIP.
//
// Designs that need no new picture (type only, type behind the product, the clean studio shot) are drawn again by
// the layout engine at each size: no model call at all. Designs built on a generated picture (a photographic scene
// or generated artwork) keep that picture's one size, so for those the square is the design you already have and
// the story and poster sizes are listed as not available, with the reason. Nothing here imports a model client.
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { renderDesign } from "./design/layouts.js";
import { makePalette } from "./design/palette.js";
import { designCopy } from "./copy.js";
import type { BriefType } from "./creativeDirectorPure.js";
import type { PlanCarry } from "./revision.js";
import { PACK_SIZES, needsScene, packAvailability, type PackSizeId } from "./packInfo.js";

export { PACK_SIZES, needsScene, packAvailability };
export type { PackSizeId };

export interface PackConcept {
  round: number;
  archetype: "typographic" | "artwork" | "product" | "behind";
  headline: string;
  body: string; // the subline
  cta: string;
  plan: PlanCarry;
  imageB64: string; // the design as it was made, JPEG
}

export interface PackBrief {
  briefType: BriefType;
  clientName: string;
  offer?: string;
  eventDate?: string;
  eventPlace?: string;
  brandColours: string[]; // hex codes from the folio or the brand colour field
}

export interface PackRequest {
  concept: PackConcept;
  brief: PackBrief;
  cutoutPng?: Buffer; // the real product cut-out, for the designs that use one
}

export interface PackSizeResult {
  id: PackSizeId;
  width: number;
  height: number;
  file: string | null; // the file name in the ZIP, or null when the size is not available
  how: "original" | "redrawn" | "not available";
  reason?: string;
}

const trimmedCopy = (c: PackConcept) => ({ headline: c.headline, subline: c.body, cta: c.cta, badge: c.plan.badge, ctaScale: c.plan.ctaScale, gapScale: c.plan.gapScale });

/** The text file in the pack: the words as they appear on the design, and what the pack holds. */
export function copyText(concept: PackConcept, brief: PackBrief, sizes: PackSizeResult[]): string {
  const copy = designCopy(trimmedCopy(concept), brief, brief.briefType);
  const lines = [
    `Headline: ${concept.headline}`,
    `Subline: ${concept.body || "(none)"}`,
    `Call to action: ${concept.cta || "(none)"}`,
  ];
  if (copy.details.length) lines.push(`Details: ${copy.details.join(" | ")}`);
  lines.push(`Brand: ${brief.clientName}`, "", "Files in this pack:");
  for (const s of sizes) lines.push(s.file ? `- ${s.file} (${s.width} x ${s.height}, ${s.how})` : `- ${s.id} ${s.width} x ${s.height}: not available, ${s.reason}`);
  return lines.join("\n") + "\n";
}

/** Draws the pack. Returns the ZIP and a description of each size. */
export async function renderPack(req: PackRequest): Promise<{ zip: Buffer; sizes: PackSizeResult[] }> {
  const { concept, brief } = req;
  const original = Buffer.from(concept.imageB64, "base64");
  const meta = await sharp(original).metadata();
  const palette = makePalette(brief.brandColours.length ? brief.brandColours : concept.plan.colours);
  const copy = designCopy(trimmedCopy(concept), brief, brief.briefType);
  const files: Record<string, Uint8Array> = {};
  const sizes: PackSizeResult[] = [];

  for (const size of PACK_SIZES) {
    const name = `${size.id}-${size.width}x${size.height}.jpg`;
    const same = meta.width === size.width && meta.height === size.height;
    if (same) {
      files[name] = original; // the design as it was made, byte for byte
      sizes.push({ ...size, file: name, how: "original" });
      continue;
    }
    const avail = packAvailability(concept.archetype).find((a) => a.id === size.id)!;
    if (!avail.available) {
      sizes.push({ ...size, file: null, how: "not available", reason: avail.reason });
      continue;
    }
    const spec = { width: size.width, height: size.height, palette, ...copy };
    let image: Buffer;
    if (concept.archetype === "typographic") {
      image = await renderDesign({ ...spec, archetype: "typographic", seed: concept.round * 7 + brief.clientName.length, pattern: concept.plan.pattern, variant: concept.plan.variant ?? undefined });
    } else if (req.cutoutPng) {
      image = await renderDesign({ ...spec, archetype: concept.archetype === "behind" ? "behind" : "product", product: req.cutoutPng });
    } else {
      sizes.push({ ...size, file: null, how: "not available", reason: "the product cut-out was not sent with the request" });
      continue;
    }
    files[name] = await sharp(image).jpeg({ quality: 90 }).toBuffer();
    sizes.push({ ...size, file: name, how: "redrawn" });
  }

  files["copy.txt"] = strToU8(copyText(concept, brief, sizes));
  return { zip: Buffer.from(zipSync(files, { level: 0 })), sizes };
}

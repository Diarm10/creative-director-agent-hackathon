// Product isolation with SAM 3.1, written for this repo from the public SAM docs
// (https://dev.meta.ai/docs/media-segmentation and /docs/sam/*).
//
//   1. Concept prompt: the request carries only a short noun phrase ("earbuds case") and the photo.
//   2. If that finds nothing, Muse Spark is asked for a bounding box on its 0 to 1000 grid, and the box
//      goes back to SAM as an object prompt (built with @meta-sam/parser).
// SAM answers as a stream of special-token text; @meta-sam/parser reads it into box and mask records, and
// decodeMaskToRaster turns a mask into 0 and 1 pixels. cutoutMask.ts then cleans the mask into a cut-out.
// Server side only: never import this from browser code.
import { buildObjectPrompt, decodeMaskToRaster, parseImageStream, recordsOfKind, type SegmentationMaskRecord } from "@meta-sam/parser";
import sharp from "sharp";
import { MODELS, meta } from "./client.js";
import { buildCutout } from "./cutoutMask.js";
import { safeJson } from "./creativeDirectorPure.js";

export interface ProductCutout {
  png: Buffer; // the product on a transparent background, trimmed to its edges
  box: { left: number; top: number; width: number; height: number }; // where it sat in the photo
  matches: number; // how many matches SAM returned
  method: "concept" | "grounding";
  prompt: string; // what was asked, for logs
  whole?: boolean; // true when the cut-out was not usable and png is the whole original photo as a panel
  photoPng: Buffer; // the upright, shrunk photo the cut-out was made from, in the pixels of `box`
}

const MAX_SIDE = 1280;

interface Photo {
  png: Buffer;
  jpegUrl: string;
  width: number;
  height: number;
}

/** The photo SAM sees: upright (EXIF rotation applied), at most 1280 px on the long side. */
async function normalisePhoto(image: Buffer): Promise<Photo> {
  const upright = sharp(image).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  const png = await upright.clone().png().toBuffer();
  const jpeg = await upright.clone().flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  const { width, height } = await sharp(png).metadata();
  return { png, jpegUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`, width: width ?? 0, height: height ?? 0 };
}

/** One SAM call. The prompt is either a noun phrase or an object prompt string. Returns the mask records. */
async function askSam(prompt: string, photo: Photo): Promise<SegmentationMaskRecord[]> {
  const events = await meta.responses.create({
    model: MODELS.segment,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: photo.jpegUrl, detail: "auto" }] }],
    stream: true,
    metadata: { include_confidence: "true" },
  } as never);
  const parsed = parseImageStream(events as unknown as AsyncIterable<{ type: string }>);
  const result = await parsed.finalResult;
  return [...recordsOfKind(result.records, "mask")];
}

/** The best match: highest confidence when SAM sent one, otherwise the largest mask. */
function bestMask(masks: readonly SegmentationMaskRecord[]): SegmentationMaskRecord | null {
  if (!masks.length) return null;
  const area = (m: SegmentationMaskRecord) => (m.bounds.right - m.bounds.left) * (m.bounds.bottom - m.bounds.top);
  return [...masks].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || area(b) - area(a))[0];
}

/** Muse Spark's box for the product on the 0 to 1000 grid, converted to pixels. Null when it cannot find one. */
export async function groundProductBox(noun: string, photo: { jpegUrl: string; width: number; height: number }): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  const prompt =
    `You are an object grounding expert. Find the ${JSON.stringify(noun)} in this image. Reply only as JSON: ` +
    `{"bbox":{"x_min":0,"y_min":0,"x_max":1000,"y_max":1000}} using a 0 to 1000 grid with (0,0) at the top left. ` +
    `If it is not in the picture reply {"bbox":null}.`;
  try {
    const res = await meta.responses.create({
      model: MODELS.text,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: photo.jpegUrl, detail: "auto" }] }],
    });
    const j = safeJson<{ bbox?: { x_min: number; y_min: number; x_max: number; y_max: number } | null }>(res.output_text ?? "");
    const b = j?.bbox;
    if (!b || ![b.x_min, b.y_min, b.x_max, b.y_max].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const clamp = (v: number) => Math.max(0, Math.min(1000, v));
    const left = Math.round((clamp(b.x_min) * photo.width) / 1000);
    const top = Math.round((clamp(b.y_min) * photo.height) / 1000);
    const right = Math.round((clamp(b.x_max) * photo.width) / 1000);
    const bottom = Math.round((clamp(b.y_max) * photo.height) / 1000);
    return right - left >= 8 && bottom - top >= 8 ? { left, top, right: Math.min(right, photo.width - 1), bottom: Math.min(bottom, photo.height - 1) } : null;
  } catch (e) {
    console.warn("[sam] grounding failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Where the named product sits in a generated scene, as a box in the scene's own pixels. One SAM call, no
 * cut-out. Null when SAM finds nothing, and the layout then falls back to its own estimate.
 */
export async function locateInScene(noun: string, scene: Buffer): Promise<{ left: number; top: number; width: number; height: number } | null> {
  try {
    const photo = await normalisePhoto(scene);
    const mask = bestMask(await askSam(noun, photo));
    if (!mask) return null;
    const sceneWidth = (await sharp(scene).metadata()).width ?? photo.width;
    const k = sceneWidth / photo.width; // the photo SAM saw may have been shrunk
    const { left, top, right, bottom } = mask.bounds;
    return { left: left * k, top: top * k, width: (right - left) * k, height: (bottom - top) * k };
  } catch (e) {
    console.warn("[sam] could not locate the product in the scene:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Cuts the named product out of a photo. Null when nothing usable is found. */
export async function cutOutProduct(noun: string, image: Buffer): Promise<ProductCutout | null> {
  const photo = await normalisePhoto(image);
  let method: ProductCutout["method"] = "concept";
  let prompt = noun;
  let masks = await askSam(noun, photo);
  let mask = bestMask(masks);

  if (!mask) {
    console.warn(`[sam] concept prompt "${noun}" found nothing, trying Muse Spark grounding`);
    const box = await groundProductBox(noun, photo);
    if (box) {
      method = "grounding";
      prompt = buildObjectPrompt({ size: { width: photo.width, height: photo.height }, objects: [{ id: 1, prompts: [{ frame: 0, box }] }] });
      masks = await askSam(prompt, photo);
      mask = bestMask(masks);
    }
  }
  if (!mask) return null;

  const cut = await buildCutout({
    photoPng: photo.png,
    raster: decodeMaskToRaster(mask.mask),
    maskW: mask.mask.width,
    maskH: mask.mask.height,
    bounds: mask.bounds,
    imgW: photo.width,
    imgH: photo.height,
  });
  if (!cut) return null;
  return { png: cut.png, box: cut.box, matches: masks.length, method, prompt, photoPng: photo.png };
}

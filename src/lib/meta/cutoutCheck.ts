// Does the cut-out work well enough to set type behind the product? A cut-out that is a sliver of the photo, nearly
// the whole photo, or mostly holes would look wrong with a headline behind it. Pure image counting, no model call.
import sharp from "sharp";

export interface CutoutVerdict {
  works: boolean;
  reason: string | null; // plain words, set when it does not work
}

const MIN_AREA = 0.04; // the product is at least 4 percent of the photo
const MAX_AREA = 0.92; // and not nearly all of it, which means the cut-out found the whole picture
const MIN_SOLID = 0.35; // and at least this share of its box is solid, so it is not a ragged scatter of pieces

/**
 * photoWidth and photoHeight are the original photo's size. The cut-out comes from a copy shrunk to at most
 * 1280 pixels on the long side, so the same shrink is applied here before the two are compared.
 */
export async function cutoutWorks(cutoutPng: Buffer, photoWidth: number, photoHeight: number): Promise<CutoutVerdict> {
  const { data, info } = await sharp(cutoutPng).ensureAlpha().resize({ width: 160, height: 160, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let solid = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) solid++;
  const solidShare = solid / (info.width * info.height);

  const meta = await sharp(cutoutPng).metadata();
  const scale = Math.min(1, 1280 / Math.max(photoWidth, photoHeight));
  const photoArea = photoWidth * scale * photoHeight * scale;
  const area = ((meta.width ?? 0) * (meta.height ?? 0)) / Math.max(1, photoArea);

  if (area < MIN_AREA) return { works: false, reason: "the product is only a small part of the photo, so the cut-out is too small to build a layout on" };
  if (area > MAX_AREA) return { works: false, reason: "the cut-out covers almost the whole photo, so it did not separate the product from its background" };
  if (solidShare < MIN_SOLID) return { works: false, reason: "the cut-out has gaps and loose pieces, so it is not clean" };
  return { works: true, reason: null };
}

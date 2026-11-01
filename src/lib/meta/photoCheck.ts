// The quick look at a product photo before any ad is made: yes or no questions only. Resolution is not asked of the
// model, because it cannot see the file size; the page works that out from the real pixels.
import { safeJson } from "./creativeDirectorPure.js";

export const PHOTO_QUESTIONS = ["person_or_hand", "several_products", "visible_brand_or_logo", "watermark", "busy_background"] as const;
export type PhotoQuestion = (typeof PHOTO_QUESTIONS)[number];
export type PhotoAnswers = Record<PhotoQuestion, boolean>;

export const PHOTO_CHECK_SYSTEM =
  "You look at one product photo for an online shop and answer yes or no questions about it. Reply with JSON only, no other text.";

export const PHOTO_CHECK_PROMPT = [
  "Look at this product photo and answer each question with true or false.",
  "person_or_hand: a person, or any part of a person such as a hand or finger, is in the photo.",
  "several_products: more than one different product is in the photo, so it is unclear which one is for sale.",
  "visible_brand_or_logo: a brand name, logo or readable trade mark is visible on the product or anywhere in the photo.",
  "watermark: the photo has a watermark or an overlaid stock photo mark.",
  "busy_background: the background is cluttered, patterned or full of other objects, not a plain or calm surface.",
  'Reply as JSON with exactly these keys: {"person_or_hand":false,"several_products":false,"visible_brand_or_logo":false,"watermark":false,"busy_background":false}',
].join("\n");

/** Reads the model's reply. Returns null when it is not a usable answer, so the page holds the photo back. */
export function parsePhotoCheck(raw: string): PhotoAnswers | null {
  const data = safeJson<Record<string, unknown>>(raw);
  if (!data || typeof data !== "object") return null;
  const out = {} as PhotoAnswers;
  for (const key of PHOTO_QUESTIONS) {
    const v = data[key];
    if (typeof v !== "boolean") return null; // a missing or odd answer is not treated as a "no"
    out[key] = v;
  }
  return out;
}

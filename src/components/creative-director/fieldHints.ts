// NEW FOR HACKATHON. Guidance for the "physical product" field. SAM finds an object by its name,
// so "sticker" works and "Join us at Circles 2026!" does not. Pure, unit tested.

/**
 * True when the value reads like a sentence or a slogan rather than the name of an object: several
 * words, sentence punctuation, a number with a percent or currency sign, or a date-like phrase.
 */
export function looksLikeSlogan(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length > 4) return true;
  if (/[.!?:;,]/.test(v)) return true;
  if (/\d+\s?%|[$€£]\s?\d|\b\d{4}\b/.test(v)) return true;
  return false;
}

export const PRODUCT_FIELD_LABEL = 'What is the physical product?';
export const PRODUCT_FIELD_PLACEHOLDER = 'e.g. sticker, earbuds, coffee mug';
export const PRODUCT_FIELD_HINT =
  'This should name the object in the photo, like "sticker" or "earbuds", not a slogan. The headline and offer go in the other fields.';

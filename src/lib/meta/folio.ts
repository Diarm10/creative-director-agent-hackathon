// A folio is a brand and product's rules: the approved facts the copy may use, and the claims and words it
// may not. Two fictional ones ship as JSON in /folios; people can make their own in the browser. A folio the
// browser sends is cleaned here, so a hand-made request cannot send oversized or odd data.
import { sanitizeFeedbackText } from "./feedbackSafety.js";
import { CHANNELS, type CreativeChannel, type FolioInput } from "./brief.js";

export interface Folio {
  id: string;
  brand_name: string;
  product_name: string;
  brand_colours: string[];
  tone_notes: string;
  product_specs: string;
  target_customer: string;
  approved_facts: string[];
  approved_claims: string[];
  banned_claims: string[];
  banned_words: string[];
  channels: CreativeChannel[];
  audience_notes: string;
}

const MAX_LIST = 30;
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i;

const text = (v: unknown, max: number) => sanitizeFeedbackText(v, max);
const list = (v: unknown, itemMax: number, listMax = MAX_LIST): string[] =>
  Array.isArray(v) ? v.map((x) => text(x, itemMax)).filter(Boolean).slice(0, listMax) : [];

/** Cleans a folio from untrusted input. Null when it has no brand or product name. */
export function sanitiseFolio(raw: unknown): Folio | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const brand = text(r.brand_name, 80);
  const product = text(r.product_name, 120);
  if (!brand || !product) return null;
  const id = typeof r.id === "string" && /^[\w-]{1,60}$/.test(r.id) ? r.id : "custom";
  return {
    id,
    brand_name: brand,
    product_name: product,
    brand_colours: (Array.isArray(r.brand_colours) ? r.brand_colours : []).filter((c): c is string => typeof c === "string" && HEX.test(c.trim())).map((c) => c.trim()).slice(0, 6),
    tone_notes: text(r.tone_notes, 200),
    product_specs: text(r.product_specs, 300),
    target_customer: text(r.target_customer, 200),
    approved_facts: list(r.approved_facts, 200),
    approved_claims: list(r.approved_claims, 200),
    banned_claims: list(r.banned_claims, 200),
    banned_words: list(r.banned_words, 60),
    channels: (Array.isArray(r.channels) ? r.channels : []).filter((c): c is CreativeChannel => CHANNELS.includes(c as CreativeChannel)),
    audience_notes: text(r.audience_notes, 300),
  };
}

/** The rules the loop checks every round against. Approved claims count as approved facts. */
export function folioToInput(f: Folio): FolioInput {
  return {
    brandColours: f.brand_colours,
    approvedFacts: [...f.approved_facts, ...f.approved_claims],
    bannedClaims: f.banned_claims,
    bannedWords: f.banned_words,
  };
}

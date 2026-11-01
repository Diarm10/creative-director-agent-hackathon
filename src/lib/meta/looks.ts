// Looks: how an ad is made. Five presets, each one named object with a layout preference order, a palette rule, a type
// scale, a finishing strength, a copy voice and a default effect. Pure and browser safe: the page lists them, the engine
// reads them. A Look never switches off a safeguard: blocked claims, the fidelity check, the overlap guard, the cut-out
// sanity check and human sign-off all run for every Look.
import type { PlanArchetype } from "./creativeDirectorPure.js";

export type LookId = "quiet" | "loud" | "spec" | "native" | "pop" | "magazine" | "sticker";
export type EffectId = "popart" | "duotone" | "halftone" | "neon";

export interface Look {
  id: LookId;
  name: string;
  description: string; // one plain sentence for the picker
  swatch: readonly [string, string, string]; // a small preview: field, ink, accent
  layouts: readonly PlanArchetype[]; // preference order; the first is round 1
  palette: readonly string[] | null; // hex colours that replace the planner's, or null to keep the planner's or the brand's
  typeScale: number; // headline size, 1 or less (a headline already fills the width, so it can only shrink)
  finish: number; // strength of the finishing pass, 0 to 1
  voice: string; // how the copy is written, as a sentence for the planner
  effect: EffectId | null; // the effect this Look starts with
  productPalette?: boolean; // the colours come from the product itself (Pop Art), unless the client or a Theme sets them
  masthead?: boolean; // Magazine Cover: the headline is one huge line across the top
  sticker?: boolean; // Sticker Pack: a thick white outline round the product, on one flat colour
  needsFact?: boolean; // Spec Sheet: callouts come only from the catalogue's fact column
}

export const LOOKS: readonly Look[] = [
  {
    id: "quiet",
    name: "Quiet Editorial",
    description: "Lots of white space, a small headline, one product and one detail line.",
    swatch: ["#F6F2EA", "#1F1D1A", "#8A7F70"],
    layouts: ["product", "artwork"],
    palette: ["#1F1D1A", "#F6F2EA", "#8A7F70", "#B8AD9C"],
    typeScale: 0.72,
    finish: 0.5,
    voice: "Calm and understated: a short plain headline and one plain detail, no exclamation marks, no hype.",
    effect: null,
  },
  {
    id: "loud",
    name: "Loud Poster",
    description: "A huge headline set behind the product on a strong colour field.",
    swatch: ["#D9382B", "#FFF4E8", "#111111"],
    layouts: ["behind", "product"],
    palette: null,
    typeScale: 1,
    finish: 1,
    voice: "Short and bold: a headline of at most three words that could be shouted.",
    effect: null,
  },
  {
    id: "spec",
    name: "Spec Sheet",
    description: "The product with two or three short callouts taken from your fact column. With no fact it becomes Quiet Editorial.",
    swatch: ["#F4F6F8", "#101820", "#2F6FED"],
    layouts: ["product", "artwork"],
    palette: ["#101820", "#F4F6F8", "#2F6FED", "#7A8794"],
    typeScale: 0.85,
    finish: 0.6,
    voice: "Factual and plain: say what the product is, nothing more.",
    effect: null,
    needsFact: true,
  },
  {
    id: "native",
    name: "Native Snap",
    description: "A plain phone-photo feel: the product in a simple scene with a short caption, no gloss.",
    swatch: ["#CDB89B", "#2B2118", "#EDE3D3"],
    layouts: ["artwork", "product"],
    palette: null,
    typeScale: 0.8,
    finish: 0.15,
    voice: "Casual, like a friend's caption: plain everyday words, one short sentence.",
    effect: null,
  },
  {
    id: "pop",
    name: "Pop Art",
    description: "Flat colours taken from the product, halftone dots that fade outward, a burst behind it and to one side, and a heavy headline. A white or black product gets a muted two-tone version.",
    swatch: ["#FFD400", "#111111", "#FF3B5C"],
    layouts: ["product", "behind"],
    palette: null,
    productPalette: true,
    typeScale: 1,
    finish: 0,
    voice: "Playful and punchy: a short headline, a little cheeky, no exclamation marks.",
    effect: "popart",
  },
  {
    id: "magazine",
    name: "Magazine Cover",
    description: "The shop name as a huge masthead word across the top, the headline as a small cover line above it, and the product overlapping the masthead.",
    swatch: ["#F2EDE4", "#111111", "#C8102E"],
    layouts: ["behind", "product"],
    palette: ["#111111", "#F2EDE4", "#C8102E", "#B8AD9C"],
    typeScale: 1,
    finish: 0.7,
    voice: "A cover line: one confident short headline of two or three words, like a magazine masthead, and a small teaser line.",
    effect: null,
    masthead: true,
  },
  {
    id: "sticker",
    name: "Sticker Pack",
    description: "The product cut out with a thick white outline, like a sticker, on one flat colour taken from the product.",
    swatch: ["#FFD93D", "#FFFFFF", "#FF6B6B"],
    layouts: ["product"],
    palette: null,
    productPalette: true,
    typeScale: 0.8,
    finish: 0,
    voice: "Friendly and short, like the words on a sticker: two or three words, light and a little playful.",
    effect: null,
    sticker: true,
  },
];

export const DEFAULT_LOOK: LookId = "loud"; // what a run without a chosen Look has always looked like: type behind the product first

export const lookById = (id: string | undefined | null): Look | null => LOOKS.find((l) => l.id === id) ?? null;

/**
 * The Look that actually runs. Spec Sheet needs a fact to take its callouts from; with none it is Quiet Editorial, and the
 * card says so. Anything not a Look is null (the engine's own default order).
 */
export function resolveLook(id: string | undefined | null, facts: string | undefined | null): { look: Look | null; note: string | null } {
  const look = lookById(id);
  if (!look) return { look: null, note: null };
  if (look.needsFact && calloutsFromFacts(facts).length === 0) {
    return { look: lookById("quiet"), note: "Spec Sheet needs a fact, and this product has none, so Quiet Editorial was used." };
  }
  return { look, note: null };
}

const LEAD = /^(a|an|the|and|with|has|have|in|on)\s+/i;
const MAX_CALLOUTS = 3;
const MAX_CALLOUT_CHARS = 30;

/**
 * Two or three short callouts from the fact column and nothing else: the fact is split at commas, semicolons, "with" and
 * "and", leading small words are dropped, and each piece is kept as written (cut at a word if it is too long). No word that
 * is not in the fact is added. An empty fact gives none.
 */
export function calloutsFromFacts(facts: string | undefined | null): string[] {
  const text = (facts ?? "").trim();
  if (!text) return [];
  const pieces = text
    .split(/[,;]|\s+with\s+|\s+and\s+|\.\s+/i)
    .map((p) => p.replace(/\.$/, "").trim().replace(LEAD, "").trim())
    .filter((p) => p.length >= 3);
  const out: string[] = [];
  for (const p of pieces) {
    let t = p;
    if (t.length > MAX_CALLOUT_CHARS) {
      const cut = t.slice(0, MAX_CALLOUT_CHARS + 1);
      t = cut.slice(0, Math.max(cut.lastIndexOf(" "), 12)).trim();
    }
    const clean = t.charAt(0).toUpperCase() + t.slice(1);
    if (!out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean);
    if (out.length === MAX_CALLOUTS) break;
  }
  return out;
}

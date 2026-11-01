// The copy engine: ad lines that read the way real ads read. For each product the planner model is asked for three candidate lines, each
// from a different angle (a practical verb tied to what the product is for, a feeling or a moment, a benefit that can be seen in the
// photo, and for Christmas a giftable line). Plain code then checks every candidate for banned patterns, ranks the valid ones with a
// cheap rule score (no second model run), and the run uses the best, with the others kept for "Show other lines".
//
// Pure and browser safe: no model call is made here, only the prompt and the checks. The few-shot examples below are original lines,
// never real brand slogans.
import { mentionsAudience } from "./creativeDirectorPure.js";
import { quoteAsData, sanitizeFeedbackText } from "./feedbackSafety.js";
import { unseenTerms } from "./visibleCopy.js";

export type ProductKind = "drinkware" | "bags" | "lighting" | "furniture" | "stationery" | "plants" | "cans" | "other";
export type Angle = "verb" | "moment" | "benefit" | "gift";

export interface Candidate {
  angle: Angle;
  headline: string; // 2 to 5 words
  subline: string; // at most 6 words
}

export const MAX_HEADLINE_WORDS = 5;
export const MIN_HEADLINE_WORDS = 2;
export const MAX_SUBLINE_WORDS = 6;

const KIND_WORDS: Record<Exclude<ProductKind, "other">, readonly string[]> = {
  drinkware: ["mug", "cup", "bottle", "flask", "glass", "tumbler", "jug", "teapot", "kettle", "carafe", "pitcher"],
  bags: ["bag", "tote", "pouch", "backpack", "satchel", "purse", "wallet", "basket"],
  lighting: ["lamp", "light", "lantern", "candle", "bulb", "sconce"],
  furniture: ["stool", "chair", "table", "shelf", "bench", "desk", "sofa", "cabinet", "rack", "stand"],
  stationery: ["notebook", "pen", "journal", "planner", "diary", "pencil", "sketchbook", "notepad"],
  plants: ["plant", "pot", "planter", "pilea", "succulent", "cactus", "fern", "vase", "flower"],
  cans: ["can", "cans", "tin", "tins"],
};

/** The kind of product, from the last words of its name: "wooden stool" is furniture, "snake plant" is a plant. */
export function kindOf(productNoun: string): ProductKind {
  const words = productNoun.toLowerCase().split(/[^a-z]+/).filter(Boolean).reverse();
  for (const w of words) for (const [kind, list] of Object.entries(KIND_WORDS)) if (list.includes(w)) return kind as ProductKind;
  return "other";
}

interface Example {
  angle: Angle;
  headline: string;
  subline: string;
}

// Original example lines, a few per type. They show the register, not wording to copy.
export const EXAMPLES: Record<ProductKind, readonly Example[]> = {
  drinkware: [
    { angle: "verb", headline: "Sip Slowly", subline: "" },
    { angle: "moment", headline: "Quiet Starts Here", subline: "" },
    { angle: "benefit", headline: "Hold On To Calm", subline: "" },
  ],
  bags: [
    { angle: "verb", headline: "Carry It All", subline: "" },
    { angle: "moment", headline: "Market Day, Hands Free", subline: "" },
    { angle: "benefit", headline: "Pack Light, Go Far", subline: "" },
  ],
  lighting: [
    { angle: "verb", headline: "Light The Corner", subline: "" },
    { angle: "moment", headline: "Evenings, Lit Softly", subline: "" },
    { angle: "benefit", headline: "Reach Over The Book", subline: "" },
  ],
  furniture: [
    { angle: "verb", headline: "Sit Anywhere", subline: "" },
    { angle: "moment", headline: "Pull Up A Seat", subline: "" },
    { angle: "benefit", headline: "Low, Steady, Yours", subline: "" },
  ],
  stationery: [
    { angle: "verb", headline: "Write It Down", subline: "" },
    { angle: "moment", headline: "Ideas Start Blank", subline: "" },
    { angle: "benefit", headline: "Pocket Sized Thinking", subline: "" },
  ],
  plants: [
    { angle: "verb", headline: "Grow Slowly", subline: "" },
    { angle: "moment", headline: "Bring The Garden In", subline: "" },
    { angle: "benefit", headline: "Greenery Without Fuss", subline: "" },
  ],
  cans: [
    { angle: "verb", headline: "Crack One Open", subline: "" },
    { angle: "moment", headline: "Raise One", subline: "" },
    { angle: "benefit", headline: "Slim Enough To Stash", subline: "" },
  ],
  other: [
    { angle: "verb", headline: "Make Room For This", subline: "" },
    { angle: "moment", headline: "A Small Good Thing", subline: "" },
    { angle: "benefit", headline: "Made To Be Used", subline: "" },
  ],
};

/** The last resort when no candidate passes: a safe, plain line per product type (from the examples, which are original). */
export const SAFE_LINES: Record<ProductKind, Candidate> = {
  drinkware: { angle: "verb", headline: "Sip Slowly", subline: "" },
  bags: { angle: "verb", headline: "Carry It All", subline: "" },
  lighting: { angle: "verb", headline: "Light The Corner", subline: "" },
  furniture: { angle: "verb", headline: "Sit Awhile", subline: "" },
  stationery: { angle: "verb", headline: "Write It Down", subline: "" },
  plants: { angle: "verb", headline: "Grow Slowly", subline: "" },
  cans: { angle: "verb", headline: "Crack One Open", subline: "" },
  other: { angle: "verb", headline: "Make Room For This", subline: "" },
};


// ---- Sublines: a benefit, an occasion, or a fact or offer the person gave. Never what the photo shows. -----------------------------

/** Words that promise what a photo cannot show: how long, how tight, how warm or cold. A line may use one only when the facts say it. */
const CLAIM_WORDS = new Set([
  "warm", "warmth", "warmer", "warming", "hot", "cold", "cool", "chilled", "lasts", "lasting", "last", "forever", "seals", "sealed", "seal", "tight", "keeps", "keep", "stays", "holds",
  "reclaimed", "recycled", "handmade", "handcrafted", "organic", "sustainable", "vintage", "antique", "artisan", "ecofriendly", "durable", "sturdy", "waterproof", "leakproof", "spillproof", "unbreakable", "guaranteed", "instantly", "effortless",
]);
/** Flaws, absences and filler: true or not, they are not how anyone writes an ad. */
const BANNED_WORDS = new Set([
  "chipped", "worn", "scratched", "scuffed", "stained", "dirty", "cracked", "damaged", "dusty", "broken", "torn", "faded", "rusty", "dented", "frayed", "peeling", "marked",
  "plain", "basic", "ordinary", "single", "blank", "bare", "empty", "generic", "regular", "standard", "simple", "unmarked", "unbranded",
]);
const BANNED_PHRASES = [
  /\bno (?:text|print|printing|logo|logos|writing|label|labels|pattern|marks?|branding|words)\b/i,
  /\bnothing (?:printed|written|on it)\b/i,
  /\bwithout (?:text|print|a logo|writing)\b/i,
  /\bsingle (?:handle|piece|colour|color)\b/i,
];
const CLAIM_PHRASES = [/\ball[- ](?:day|night|week|year)\b/i, /\bfor (?:years|life|ever)\b/i, /\bevery (?:day|time)\b/i];
/** Colour, material and part words: what a photo shows, and so what an alt text says. */
const COLOUR_WORDS = new Set(["white", "black", "grey", "gray", "green", "red", "blue", "beige", "brown", "cream", "yellow", "orange", "pink", "purple", "gold", "golden", "silver", "navy", "tan", "natural", "terracotta", "ivory", "charcoal", "metallic", "neon"]);
const MATERIAL_WORDS = new Set(["ceramic", "wood", "wooden", "steel", "metal", "glass", "cotton", "linen", "jute", "woven", "leather", "plastic", "paper", "stone", "clay", "bamboo", "rope", "wire", "canvas", "enamel", "aluminium", "aluminum", "brass", "fabric"]);
const PART_WORDS = new Set(["handle", "handles", "lid", "cap", "collar", "shade", "arm", "joint", "joints", "seat", "legs", "base", "leaves", "pot", "saucer", "spout", "rim", "strap", "straps", "zip", "loop", "bulb", "cover", "spine", "pages", "frame", "dropper", "label", "packaging", "box", "sleeve"]);
const SKIP = new Set(["this", "that", "with", "from", "your", "into", "they", "them", "will", "have", "what", "when", "more", "than", "just", "every", "each", "made", "make", "gift", "love", "home", "ready", "give"]);
const stem = (w: string): string => w.replace(/(?:es|s)$/, "");

/**
 * Why a line (a headline or a subline) breaks the copy rules, or null. Filler and flaw words and "no text" style absences are never allowed.
 * A subline may not describe the photo at all: no colour, material, part or word of the vision description or of the product's name beyond its noun.
 * A headline may use a photo word only when it is not one the photo analysis or the facts hand it.
 */
export function lineReason(text: string, kind: "headline" | "subline", ctx: Pick<CheckContext, "productNoun" | "visible" | "facts">): string | null {
  const line = text.trim();
  if (!line) return null;
  const toks = tokens(line);
  if (kind === "headline") {
    // Odd or broken English: "Sit A While" (it is one word, "awhile"), a line that ends on "a while", or one that ends on a bare article.
    for (let i = 0; i + 1 < toks.length; i++) if (toks[i] === "a" && toks[i + 1] === "while") return 'it reads as broken English ("a while" should be "awhile")';
    if (["a", "an", "the"].includes(toks[toks.length - 1])) return "it ends on a dangling article";
  }
  const banned = toks.find((w) => BANNED_WORDS.has(w));
  if (banned) return `it uses "${banned}", which reads like a description or a flaw`;
  const absent = BANNED_PHRASES.map((r) => line.match(r)?.[0]).find(Boolean);
  if (absent) return `it says "${absent}", which describes what is missing`;
  const nounToks = tokens(ctx.productNoun);
  const lastNoun = nounToks[nounToks.length - 1] ?? "";
  const nounSet = new Set([lastNoun, stem(lastNoun)].filter(Boolean));
  const evidence = new Set(tokens(`${ctx.facts ?? ""} ${ctx.visible ?? ""} ${ctx.productNoun}`).flatMap((w) => [w, stem(w)]));
  // Colour and material words are never allowed in a headline or a subline. A part word (handle, lid, shade) is a description in a subline,
  // and in a headline when the photo analysis or the facts hand it over.
  const attr = toks.find((w) => {
    if (nounSet.has(w) || nounSet.has(stem(w))) return false;
    if (COLOUR_WORDS.has(w) || MATERIAL_WORDS.has(w) || COLOUR_WORDS.has(stem(w)) || MATERIAL_WORDS.has(stem(w))) return true;
    return (PART_WORDS.has(w) || PART_WORDS.has(stem(w))) && (kind === "subline" || evidence.has(w) || evidence.has(stem(w)));
  });
  if (attr) return `it uses "${attr}", a colour, material or part that the photo shows`;
  // Any word of the product's name (beyond its noun) or of the photo description is a repeat, in a headline or a subline.
  const seen = new Set([...nounToks.slice(0, -1), ...tokens(ctx.visible ?? "")].filter((w) => w.length > 3 && !SKIP.has(w)).flatMap((w) => [w, stem(w)]));
  const echo = toks.find((w) => w.length > 3 && !nounSet.has(w) && (seen.has(w) || seen.has(stem(w))));
  if (echo) return `it repeats "${echo}" from the product's name or the photo`;
  const stated = new Set(tokens(`${ctx.facts ?? ""} ${ctx.productNoun}`).flatMap((w) => [w, stem(w)]));
  const claim = toks.find((w) => CLAIM_WORDS.has(w) && !stated.has(w) && !stated.has(stem(w)));
  if (claim) return `it says ${claim}, which the photo cannot show`;
  // A headline that is only a verb and "something" says nothing about the product.
  if (kind === "headline" && toks.length >= 2 && toks.length <= 3 && toks[1] === "something") return `it is only a verb and "something", which says nothing about the product`;
  const phrase = CLAIM_PHRASES.map((r) => line.match(r)?.[0]).find(Boolean);
  if (phrase && kind === "subline") return `it says "${phrase}", which the photo cannot show`;
  return null;
}

/** Why a subline may not be used, or null. An empty subline is always fine. */
export const sublineReason = (subline: string, ctx: Pick<CheckContext, "productNoun" | "visible" | "facts">): string | null => {
  const r = lineReason(subline, "subline", ctx);
  return r ? `the subline ${r.replace(/^it /, "")}` : null;
};

/** The one safe occasion line a gifting theme may add when there is nothing better, and only for a product that is a plausible gift. */
export const OCCASION_LINES: Readonly<Record<string, readonly string[]>> = {
  christmas: ["A gift they will use", "Wrapped and ready", "For someone you love", "A gift worth giving"],
  valentines: ["A gift for someone you love", "A gift from the heart", "For your favourite person", "Thoughtful and ready to give"],
  mothersday: ["A gift for the mum in your life", "A gift she will use", "For the mum who does it all", "Because she deserves it"],
};
export const plausibleGift = (productNoun: string): boolean => kindOf(productNoun) !== "other";
/** One of the theme's four lines, picked by the product's place in the batch so neighbouring ads differ. */
export const occasionLine = (themeId: string | undefined, productNoun: string, index = 0): string => {
  const lines = themeId ? OCCASION_LINES[themeId] : undefined;
  return lines && plausibleGift(productNoun) ? lines[Math.abs(Math.trunc(index)) % lines.length] : "";
};

/** The button: "Shop now", unless a gifting theme meets a plausible gift. */
export function buttonFor(themeId: string | undefined, themeCta: string | undefined, productNoun: string): string {
  return themeId && OCCASION_LINES[themeId] && themeCta && plausibleGift(productNoun) ? themeCta : "Shop now";
}

// ---- A quick sense check ----------------------------------------------------------------------------------------------------------

/** One short model question for all the candidate lines: does each make sense for this product? */
export function sensePrompt(productNoun: string, lines: readonly Candidate[]): string {
  const noun = quoteAsData(sanitizeFeedbackText(productNoun, 80));
  return (
    `Does each line make sense for a ${noun}? A line makes sense when it is natural English and says something a real shop could say about that product. ` +
    `It does not make sense when it is about a different kind of object, is a puzzling phrase, or the subline does not follow from the headline.\n` +
    lines.map((c, i) => `${i + 1}. headline ${quoteAsData(c.headline)}, subline ${quoteAsData(c.subline || "none")}`).join("\n") +
    `\nReply only as JSON: {"results":[{"n":1,"ok":true},...]} with one result for each line.`
  );
}

/** The model's verdicts, as one boolean for each line. Null when the answer cannot be read, so the check never blocks on its own failure. */
export function parseSense(raw: unknown, count: number): boolean[] | null {
  const list = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return null;
  const out: boolean[] = Array(count).fill(true);
  let seen = 0;
  for (const r of list) {
    const o = (r ?? {}) as { n?: unknown; ok?: unknown };
    if (typeof o.n === "number" && o.n >= 1 && o.n <= count && typeof o.ok === "boolean") { out[o.n - 1] = o.ok; seen++; }
  }
  return seen ? out : null;
}

/** The opening words of a headline, for the batch rule: the first word, plus "something" wherever it sits. */
export function openingsOf(headline: string): string[] {
  const t = tokens(headline);
  return [...new Set([t[0], t.includes("something") ? "something" : ""].filter(Boolean))];
}

/** From the headlines of the ads already finished in a batch: the openings to keep out of the next one. */
export function openingsToAvoid(headlines: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const h of headlines) for (const o of openingsOf(h)) seen.add(o);
  return [...seen].slice(0, 12);
}

/** Verbs a practical, imperative line starts with. */
const VERBS = new Set([
  "sip", "carry", "light", "sit", "write", "hang", "pour", "grow", "brew", "hold", "keep", "fill", "pack", "read", "rest", "lift", "wake", "pause", "plant", "chill", "cool", "stash", "stack",
  "tuck", "pull", "pick", "bring", "make", "take", "start", "fold", "wrap", "store", "serve", "stir", "toast", "crack", "raise", "open", "lean", "perch", "swing", "glow", "shine", "doodle", "jot", "sketch", "scribble",
]);

const GIFT_THEMES = new Set(["christmas", "valentines", "mothersday"]);

/** The angles asked for: practical verb, a moment, a benefit seen in the photo; Christmas swaps the benefit for a giftable line. */
export function anglesFor(themeId: string | undefined): Angle[] {
  return themeId && GIFT_THEMES.has(themeId) ? ["verb", "moment", "gift"] : ["verb", "moment", "benefit"];
}

const ANGLE_TEXT: Record<Angle, string> = {
  verb: "verb: a practical imperative tied to what the product is used for (for example sip, carry, light, sit, write, hang, pour)",
  moment: "moment: a feeling or a moment of using it",
  benefit: "benefit: what using it gives the person, stated as a benefit and never as a description of the picture",
  gift: "gift: a giftable line, about giving or receiving, in warm plain words",
};

const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);
const tokens = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** The prompt for the three candidate lines. Everything typed by a person is quoted as data. */
export function copyPrompt(o: { productNoun: string; facts: string; visible: string; angles: readonly Angle[]; voice: string; offer: string; shop: string; avoid?: readonly string[] }): string {
  const kind = kindOf(o.productNoun);
  const q = (s: string, n = 200) => quoteAsData(sanitizeFeedbackText(s, n));
  const modifiers = tokens(o.productNoun).slice(0, -1);
  return (
    `You write ad lines the way real ads read: short, concrete, human, with one clear idea. Write three candidate lines for ${q(o.productNoun, 80)} (a ${kind} product), one for each angle:\n` +
    o.angles.map((a) => `- ${ANGLE_TEXT[a]}`).join("\n") +
    `\n\nRules for every candidate:\n` +
    `- headline: ${MIN_HEADLINE_WORDS} to ${MAX_HEADLINE_WORDS} words.\n` +
    `- Never describe the photo (no "upright variegated foliage"). The photo is described below for your eyes only.\n` +
    `- Never write "Give This ...", "Gift This ..." or a headline that is just the product name.\n` +
    `- Never use an adjective from the product name as the hook${modifiers.length ? ` (here: ${modifiers.join(", ")})` : ""}.\n` +
    `- No hype words (best, perfect, amazing), no dashes, no exclamation marks.\n` +
    `- Always set the subline to an empty string (""). The shop's own words, if any, are added separately. Never write a subline yourself: nothing about what the photo shows (no colour, material, shape, part or packaging), no flaw or absence (no "plain", "basic", "single", "no text", "worn", "chipped"), no promise (how long it lasts, whether it seals, whether it keeps things warm or cold). The headline must be short, make sense for a ${q(o.productNoun, 80)}, use no word of the product's name or the photo description beyond its noun, no colour or material word, and must not be a pun that does not fit or just the kind of product it is.\n` +
    (o.avoid && o.avoid.length ? `- Other ads in this batch already start with or use: ${o.avoid.map((w) => `"${w}"`).join(", ")}. Do not start a headline with those words, and use a different opening verb and sentence shape.\n` : "") +
    `- Use only the facts given. Never invent a price, percentage, date, code, scarcity or delivery claim.` +
    (o.offer ? ` The only offer you may quote is exactly: ${q(o.offer, 140)}.` : ` There is no offer, so state no figure at all.`) +
    `\n- Do not name who it is for (no "for online shoppers").\n` +
    (o.voice ? `- ${o.voice.trim()}\n` : "") +
    `\nExamples of the register for this kind of product (original lines, do not copy their words):\n` +
    EXAMPLES[kind].map((e) => `${e.angle}: headline "${e.headline}", subline "${e.subline}"`).join("\n") +
    `\n\nFacts about the product, as data: ${o.facts ? q(o.facts, 300) : "none given"}.` +
    (o.shop ? ` The shop is ${q(o.shop, 60)}.` : "") +
    (o.visible ? ` What the photo shows, for your eyes only: ${q(o.visible, 200)}.` : "") +
    `\n\nReply only as JSON: {"candidates":[{"angle":"${o.angles[0]}","headline":"...","subline":"..."},...]} with exactly ${o.angles.length} candidates, in the order of the angles above.`
  );
}

/** Reads the candidates out of the model's JSON. Anything malformed is dropped. */
export function parseCandidates(raw: unknown): Candidate[] {
  const list = (raw as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(list)) return [];
  const out: Candidate[] = [];
  for (const c of list) {
    const r = (c ?? {}) as Record<string, unknown>;
    const angle = (["verb", "moment", "benefit", "gift"] as const).find((a) => a === r.angle);
    const headline = tidy(r.headline, 60);
    if (!angle || !headline) continue;
    out.push({ angle, headline, subline: tidy(r.subline, 70) });
  }
  return out.slice(0, 4);
}

/** One line of text: no dashes, no exclamation marks, one space between words, a capital on each headline word is left to the layout. */
function tidy(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[–—]/g, ",").replace(/!/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// Words that describe the picture instead of selling the product.
const PHOTO_WORDS = new Set(["upright", "variegated", "foliage", "tilted", "leaning", "glossy", "matte", "textured", "photographed", "pictured", "backdrop", "background", "studio", "shown", "wireframe", "silhouette"]);
const HYPE = new Set(["best", "perfect", "amazing", "ultimate", "incredible", "stunning", "premium", "luxury", "unbeatable", "revolutionary"]);

export interface CheckContext {
  productNoun: string;
  visible?: string; // what the product image shows, for the "not seen" and "describes the photo" checks
  audience?: string;
  facts?: string;
  avoid?: readonly string[]; // openings other ads in this batch already use
  preferAngle?: Angle; // the angle this product leads with, so neighbours in a batch differ
}

/** Why a candidate may not be used, in a few words, or null when it passes every banned-pattern check. */
export function bannedReason(c: Candidate, ctx: CheckContext): string | null {
  const h = words(c.headline);
  const s = words(c.subline);
  if (h.length < MIN_HEADLINE_WORDS || h.length > MAX_HEADLINE_WORDS) return `the headline has ${h.length} words, and it needs ${MIN_HEADLINE_WORDS} to ${MAX_HEADLINE_WORDS}`;
  if (s.length > MAX_SUBLINE_WORDS) return `the subline has ${s.length} words, and the limit is ${MAX_SUBLINE_WORDS}`;
  const line = `${c.headline} ${c.subline}`;
  if (/\b(give|gift)\s+(this|that|these|those)\b/i.test(line)) return `it uses "Give This" or "Gift This"`;
  const noun = tokens(ctx.productNoun);
  const hTokens = tokens(c.headline);
  const nounSet = new Set(noun.flatMap((w) => [w, w.replace(/e?s$/, "")]));
  if (hTokens.length && hTokens.every((w) => nounSet.has(w) || nounSet.has(w.replace(/e?s$/, "")) || w === "the" || w === "a" || w === "an")) return "the headline is just the product name";
  const modifiers = noun.slice(0, -1);
  const hook = hTokens.find((w) => modifiers.includes(w));
  if (hook) return `the headline uses "${hook}" from the product's name as its hook`;
  const photo = tokens(line).find((w) => PHOTO_WORDS.has(w));
  if (photo) return `it describes the photo ("${photo}")`;
  const hype = tokens(line).find((w) => HYPE.has(w));
  if (hype) return `it uses a hype word ("${hype}")`;
  if (ctx.visible) {
    // Two or more of the picture's own words in the headline means it is reading the photo back.
    const seenWords = new Set(tokens(ctx.visible).filter((w) => w.length > 3 && !nounSet.has(w)));
    const echoed = hTokens.filter((w) => seenWords.has(w));
    if (echoed.length >= 2) return `the headline repeats what the photo shows ("${echoed.join(" ")}")`;
    const unseen = unseenTerms(line, `${ctx.visible} ${ctx.productNoun}`);
    if (unseen.length) return `it names ${unseen.join(", ")}, which the photo does not show`;
  }
  if (ctx.audience && mentionsAudience(line, ctx.audience, ctx.productNoun)) return "it names the audience";
  if (/[!]|[–—]/.test(line)) return "it has an exclamation mark or a dash";
  const hl = lineReason(c.headline, "headline", ctx);
  if (hl) return `the headline ${hl.replace(/^it /, "")}`;
  const kindWords = new Set(Object.values(KIND_WORDS).flat());
  if (hTokens.length && hTokens.every((w) => kindWords.has(w) || kindWords.has(stem(w)) || nounSet.has(w) || w === "the" || w === "a" || w === "an")) return "the headline just states the kind of product";
  if (ctx.avoid?.length) {
    const open = openingsOf(c.headline).find((o) => ctx.avoid!.includes(o));
    if (open) return `it opens with "${open}", which another ad in this batch already uses`;
  }
  return sublineReason(c.subline, ctx);
}

/** The cheap check that picks the best: a rule score, no model call. Higher is better. */
export function scoreCandidate(c: Candidate, ctx: CheckContext): number {
  const h = tokens(c.headline);
  const kind = kindOf(ctx.productNoun);
  let score = 0;
  if (VERBS.has(h[0] ?? "")) score += 3; // an imperative reads like an ad
  if (c.angle === "verb") score += 1;
  if (h.length >= 2 && h.length <= 4) score += 1;
  if (EXAMPLES[kind].some((e) => VERBS.has(tokens(e.headline)[0]) && h.includes(tokens(e.headline)[0]))) score += 1;
  if (new Set(h).size < h.length) score -= 2; // a repeated word
  if (h.includes("something")) score -= 1; // a formula that spreads across a batch
  if (ctx.preferAngle && c.angle === ctx.preferAngle) score += 2;
  return score;
}

export interface Ranked {
  best: Candidate;
  others: Candidate[]; // the other valid candidates, best first, for "Show other lines"
  rejected: { candidate: Candidate; why: string }[];
}

/** Drops the candidates that break a rule, ranks the rest, and returns the best and the others. Null when none are valid. */
export function rankCandidates(cands: readonly Candidate[], ctx: CheckContext): Ranked | null {
  const rejected: Ranked["rejected"] = [];
  const valid: Candidate[] = [];
  for (const c of cands) {
    const why = bannedReason(c, ctx);
    if (why) rejected.push({ candidate: c, why });
    else valid.push(c);
  }
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => scoreCandidate(b, ctx) - scoreCandidate(a, ctx));
  return { best: sorted[0], others: sorted.slice(1), rejected };
}

/** The reasons candidates were rejected, for the one retry prompt. */
export function retryNote(rejected: Ranked["rejected"]): string {
  return rejected.map((r) => `"${r.candidate.headline}" was rejected because ${r.why}`).join("; ");
}

/** For the score: the first copy rule the finished headline or subline breaks, in plain words, or null. */
export function copyRuleBreak(headline: string, subline: string, ctx: Pick<CheckContext, "productNoun" | "visible" | "facts">): string | null {
  const h = lineReason(headline, "headline", ctx);
  if (h) return `the headline ${h.replace(/^it /, "")}`;
  return sublineReason(subline, ctx);
}

/**
 * The only words a subline may carry besides a theme's occasion line: a fact or an offer the person supplied (the CSV fact column, the offer
 * box, a folio's approved claims). The first one, or the first piece of one, that is short enough and passes every rule. Empty when none does.
 * Nothing here is written by a model, and nothing is made up from the photo.
 */
export function givenSubline(sources: ReadonlyArray<string | undefined>, ctx: Pick<CheckContext, "productNoun" | "visible" | "facts">, maxWords = 8): string {
  for (const raw of sources) {
    const text = (raw ?? "").replace(/[–—]/g, ",").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
    if (!text) continue;
    const tries = [text, ...text.split(/[.;]\s+/).map((p) => p.trim())]; // whole sentences only: a clause cut out of a longer fact reads as a fragment
    for (const t of tries) {
      if (!t || words(t).length > maxWords || /[!]/.test(t)) continue;
      if (lineReason(t, "subline", { ...ctx, facts: text }) === null) return t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return "";
}

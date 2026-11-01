// Pure helper functions for the Creative Director loop: no network calls, directly unit-testable.
// Kept separate from loop.ts so these rules can be tested without mocking the Meta API.

import { pickBest } from "./runEnd.js";

// Inlined rather than imported so this module has no imports at all and loads the same way under tsx,
// Vercel's build and plain `node --test`. The rule is one line: no em dash, and an en dash becomes a hyphen.
function sanitizeAiText(s: string): string {
  return s.replace(/\u2014/g, ",").replace(/\u2013/g, "-");
}

export interface ScoredRound {
  round: number;
  score: number;
  archetype?: string;
  legibility?: number;
  composition?: number;
}

/**
 * Highest-scoring round wins. On a tie the higher legibility wins, then the higher composition, then a photographic scene,
 * then the later round (see beats in runEnd.ts). Type behind the product has no preference of its own.
 */
export function pickFinalRoundIndex(rounds: readonly ScoredRound[]): number {
  return pickBest(rounds);
}

/**
 * A fidelity mismatch (the ad shows a different product than the customer's own photo) caps the
 * round's score regardless of what the copy critic gave it -- a beautifully written ad for the
 * wrong product is still a failed round.
 */
export function applyFidelityGate(score: number, sameProduct: boolean, cap = 4): number {
  return sameProduct ? score : Math.min(score, cap);
}

const FILLER = new Set(["for", "the", "a", "an", "and", "to", "of"]);
const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));

/** True for a headline that is only the audience, such as "For Online Shoppers". */
export function isAudienceHeadline(headline: string, audience: string): boolean {
  const h = words(headline);
  const a = new Set(words(audience));
  return h.length > 0 && a.size > 0 && h.every((w) => a.has(w));
}

/**
 * True when the text names the audience: any word of the audience (four letters or more) that is not also part of the
 * product's own name. "White Cans for Online Shoppers" names the audience "online shoppers"; "Table Lamp" does not.
 * An ad that says who it is for reads as a template, so the planner is asked to write from the product instead.
 */
export function mentionsAudience(text: string, audience: string, productNoun = ""): boolean {
  const own = new Set(words(productNoun));
  const aud = words(audience).filter((w) => w.length >= 4 && !own.has(w));
  const t = new Set(words(text));
  return aud.some((w) => t.has(w));
}

/** Headline/body must never contain an em or en dash, the same rule applies to every model output here. */
export function cleanCopy(copy: { headline: string; body: string }): { headline: string; body: string } {
  return { headline: sanitizeAiText(copy.headline), body: sanitizeAiText(copy.body) };
}

/**
 * Removes the reasoning some open models print before their answer: closed <think> or <thinking>
 * blocks. An unclosed block is left alone, because the answer may follow it.
 */
export function stripReasoning(s: string): string {
  return s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, " ").trim();
}

/** Light repairs for the formatting slips open models make inside an otherwise valid JSON object. */
function repairCandidates(candidate: string): string[] {
  const out = [candidate];
  const cleaned = candidate
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1"); // trailing commas
  if (cleaned !== candidate) out.push(cleaned);
  // Single-quoted keys and strings, only when there are no double quotes to confuse.
  if (!cleaned.includes('"') && cleaned.includes("'")) out.push(cleaned.replace(/'/g, '"'));
  return out;
}

/** Every balanced {...} in the text, in order of where it starts, aware of strings and escapes. */
function balancedObjects(s: string, limit = 40): string[] {
  const found: string[] = [];
  for (let i = 0; i < s.length && found.length < limit; i++) {
    if (s[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let quote = "";
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === quote) inString = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
      } else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        found.push(s.slice(i, j + 1));
        break;
      }
    }
  }
  return found;
}

/**
 * Forgiving JSON-from-model-text extraction used throughout the Creative Director loop. It copes with
 * the habits of different models: a preface or closing remark, code fences, reasoning blocks, smart
 * quotes, single quotes and trailing commas. Returns the first object that parses, or null.
 */
export function safeJson<T>(s: string): T | null {
  const text = stripReasoning(s).replace(/```[a-zA-Z]*/g, " ");
  for (const candidate of balancedObjects(text)) {
    for (const attempt of repairCandidates(candidate)) {
      try {
        const parsed: unknown = JSON.parse(attempt);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
      } catch {
        // try the next repair, then the next object
      }
    }
  }
  return null;
}

export interface FolioGuardrails {
  bannedClaims: readonly string[];
  bannedWords: readonly string[];
  approvedFacts: readonly string[];
}

export interface ComplianceResult {
  passed: boolean;
  reason: string | null;
}

/** Matches text() in client.ts: (input, instructions?, opts?) => Promise<output text>. */
export type TextCaller = (input: string, instructions?: string, opts?: { temperature?: number }) => Promise<string>;

export interface ClaimVerdict {
  claim: string;
  verdict: "supported" | "unsupported" | "banned";
  reason?: string | null;
}

/**
 * Checks a round's copy against a Product Folio's guardrails.
 *
 * Order matters: banned words are an exact, case-insensitive match first (cheap, deterministic, and
 * they always win, even for text the user typed into the form). Then Muse Spark lists each claim in
 * the copy and gives a per-claim verdict against the approved facts PLUS runFacts, the things the
 * user supplied for this run (offer, date, place, title, call to action). A verdict of "banned" or
 * "unsupported" fails the check; the verdict is applied here in code, not left to a free-form
 * yes or no from the model. Temperature 0 keeps the same copy from passing once and failing next.
 * Fails open if the model call throws or returns unparseable JSON, because an inconclusive check
 * isn't evidence of a violation.
 */
export async function checkFolioCompliance(
  headline: string,
  body: string,
  folio: FolioGuardrails | null,
  callText: TextCaller,
  runFacts: readonly string[] = [],
): Promise<ComplianceResult> {
  if (!folio) return { passed: true, reason: null };

  const lowerCopy = `${headline} ${body}`.toLowerCase();
  const bannedWordHit = folio.bannedWords.find((w) => w.trim() && lowerCopy.includes(w.trim().toLowerCase()));
  if (bannedWordHit) return { passed: false, reason: `Banned word "${bannedWordHit}" found in the copy` };

  if (folio.bannedClaims.length === 0 && folio.approvedFacts.length === 0) {
    return { passed: true, reason: null };
  }

  const supplied = runFacts.map((f) => f.trim()).filter(Boolean);
  const prompt =
    `Banned claims (must never appear, even implied, even if the user's own text seems to allow them): ` +
    `${folio.bannedClaims.join("; ") || "none listed"}\n` +
    `Approved facts from the brand folio: ${folio.approvedFacts.join("; ") || "none listed"}\n` +
    `Also approved for this run (typed in by the user): ${supplied.join("; ") || "none"}\n\n` +
    `Headline: ${headline}\nBody: ${body}\n\n` +
    `List every factual claim the copy makes (offers, numbers, features, benefits, promises). For each one ` +
    `give a verdict: "supported" if it is covered by an approved fact or by the text typed in for this run, ` +
    `"banned" if it matches a banned claim, "unsupported" if it is neither. Opinion and tone are not claims. ` +
    `Answer only as JSON: {"claims":[{"claim":"...","verdict":"supported|banned|unsupported","reason":"..."}]}`;
  try {
    const raw = await callText(prompt, "You are a strict, consistent brand compliance reviewer.", { temperature: 0 });
    const parsed = safeJson<{ claims?: ClaimVerdict[]; violation?: boolean; reason?: string | null }>(raw);
    if (!parsed) return { passed: true, reason: null };
    if (Array.isArray(parsed.claims)) {
      const bad = parsed.claims.find((c) => c.verdict === "banned" || c.verdict === "unsupported");
      if (!bad) return { passed: true, reason: null };
      const why = bad.reason ? `: ${bad.reason}` : "";
      return { passed: false, reason: `${bad.verdict === "banned" ? "Banned claim" : "Unsupported claim"} "${bad.claim}"${why}` };
    }
    // Older single-verdict shape, still accepted.
    return parsed.violation ? { passed: false, reason: parsed.reason ?? "Unapproved claim or fact" } : { passed: true, reason: null };
  } catch {
    return { passed: true, reason: null };
  }
}

/** A folio-compliance violation caps the round's score, same mechanism as the fidelity gate. */
export function applyFolioGate(score: number, passed: boolean, cap = 4): number {
  return passed ? score : Math.min(score, cap);
}

/** The product_folios columns the agent needs (migration 156). */
export interface ProductFolioRow {
  brand_colours: string[] | null;
  heading_font: string;
  body_font: string;
  logo_url: string | null;
  approved_facts: string[] | null;
  approved_claims: string[] | null;
  banned_claims: string[] | null;
  banned_words: string[] | null;
}

/** Maps a server-loaded folio row to the loop's folio input. Approved claims count as approved
 * facts for the compliance check, since both are things the copy is allowed to say. */
export function folioRowToInput(row: ProductFolioRow) {
  const clean = (xs: string[] | null) => (xs ?? []).map((x) => x.trim()).filter(Boolean);
  return {
    brandColours: clean(row.brand_colours),
    headingFont: row.heading_font,
    bodyFont: row.body_font,
    logoUrl: row.logo_url,
    approvedFacts: [...clean(row.approved_facts), ...clean(row.approved_claims)],
    bannedClaims: clean(row.banned_claims),
    bannedWords: clean(row.banned_words),
  };
}

/**
 * The final NDJSON event. Every round_done already streamed its image, so if repeating them would
 * push the response past the byte limit, the final result drops the images and says so; the
 * client keeps the ones it already has.
 */
export function buildResultEvent<R extends { concepts: { imageB64: string }[] }>(
  result: R,
  bytesSoFar: number,
  limit: number,
): { type: "result"; result: R; imagesOmitted: boolean } {
  const full = { type: "result" as const, result, imagesOmitted: false };
  if (bytesSoFar + Buffer.byteLength(JSON.stringify(full)) + 1 <= limit) return full;
  return {
    type: "result",
    result: { ...result, concepts: result.concepts.map((c) => ({ ...c, imageB64: "" })) },
    imagesOmitted: true,
  };
}

// ---- Round planning and honest vision critique ----

export type BriefType = "product" | "event" | "promo";
export type PlanArchetype = "typographic" | "artwork" | "behind" | "product";
export type PatternName = "diagonals" | "grid" | "arcs" | "bars";
export type VariantName = "stack" | "anchor" | "block";

export interface RoundPlan {
  archetype: PlanArchetype;
  artPrompt: string; // what the artwork shows, never any text
  headline: string;
  subline: string;
  badge: string[];
  cta: string;
  pattern: PatternName;
  variant: VariantName | null; // typographic layout variant the planner chose, null leaves it to the seed
  colours: string[]; // hex colours the planner picked when the brief gave none
  ctaScale: number; // size of the call to action pill, 1 unless a revision changed it
  gapScale: number; // spacing between the text lines, 1 unless a revision changed it
  overlapGuard: number; // type behind the product: 0 is the normal limit, each step asks for more of the last line to stay visible
  productScale: number; // size of the product in the studio and type-behind layouts, 1 unless a revision changed it
  headScale: number; // size of the headline in those layouts, 1 unless a revision changed it
  applied: string[]; // a revision: what the person's note changed, in plain words
  ignored: string[]; // a revision: what the note asked for that could not be done
  ctaChange: ScaleChange; // what the planner asked for relative to the design being revised
  gapChange: ScaleChange;
}

export type ScaleChange = "larger" | "same" | "smaller";
export const SCALE_LIMITS = { cta: [0.8, 1.5], gap: [0.35, 2.2] } as const;
const SCALE_STEP = 1.25;

/** The new absolute scale after a relative change, kept inside the limits the layout engine accepts. */
export function applyScaleChange(current: number, change: ScaleChange, limits: readonly [number, number], step: number = SCALE_STEP): number {
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  const next = change === "larger" ? base * step : change === "smaller" ? base / step : base;
  return Math.round(Math.min(limits[1], Math.max(limits[0], next)) * 100) / 100;
}

/** A scale carried in from a client request: a number inside the limits, otherwise 1. */
export function cleanScale(v: unknown, limits: readonly [number, number]): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(limits[1], Math.max(limits[0], v)) * 100) / 100 : 1;
}

const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? sanitizeAiText(s).replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Reads the model's plan for a round, tolerating missing or odd fields. The headline falls back to
 * the user's title, so a flaky answer never leaves a design with no headline.
 */
export function parsePlan(raw: string, allowed: readonly PlanArchetype[], fallbackHeadline: string): RoundPlan {
  const j = safeJson<Record<string, unknown>>(raw) ?? {};
  const archetype = allowed.includes(j.archetype as PlanArchetype) ? (j.archetype as PlanArchetype) : allowed[0];
  const pattern = (["diagonals", "grid", "arcs", "bars"] as const).find((p) => p === j.pattern) ?? "diagonals";
  const variant = (["stack", "anchor", "block"] as const).find((v) => v === j.layout) ?? null;
  const badge = Array.isArray(j.badge) ? j.badge.map((b) => clip(b, 18)).filter(Boolean).slice(0, 2) : [];
  const change = (v: unknown, up: string, down: string): ScaleChange => (v === up ? "larger" : v === down ? "smaller" : "same");
  return {
    archetype,
    artPrompt: clip(j.art_prompt, 400),
    headline: clip(j.headline, 60) || clip(fallbackHeadline, 60),
    subline: clip(j.subline, 90),
    badge,
    cta: clip(j.cta, 64),
    pattern,
    variant,
    colours: Array.isArray(j.colours)
      ? j.colours.filter((c): c is string => typeof c === "string" && /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i.test(c.trim())).map((c) => c.trim()).slice(0, 4)
      : [],
    ctaScale: 1,
    gapScale: 1,
    overlapGuard: 0,
    productScale: 1,
    headScale: 1,
    applied: [],
    ignored: [],
    ctaChange: change(j.cta_size, "larger", "smaller"),
    gapChange: change(j.spacing, "looser", "tighter"),
  };
}

export const PART_KEYS = ["legibility", "hierarchy", "composition", "brandFit", "fidelity", "originality"] as const;
export type PartKey = (typeof PART_KEYS)[number];

export interface PartScore {
  score: number; // 1 to 10
  note: string; // one short sentence of reasoning
}
export type CriticParts = Record<PartKey, PartScore>;

export interface VisionCritique {
  score: number; // 1 to 10 after caps
  rawScore: number; // the mean of the six parts before any cap
  parts: CriticParts | null; // null only when the critic returned no usable breakdown
  capReason: string | null; // why the score was held down, when a cap applied
  weakness: string;
  fix: string;
  defects: string[]; // hard failures, each of which caps the score at 4
  notes: string[]; // softer problems that lower the score without the hard cap
  available: boolean;
}

export const DEFECT_CAP = 4;
export const TEXT_HIDDEN_CAP = 5; // text hidden by the product caps the score here

/** Reads the six per-part scores. Returns null unless all six are present with a numeric score. */
export function parseParts(value: unknown): CriticParts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const out = {} as CriticParts;
  for (const key of PART_KEYS) {
    const p = v[key];
    if (!p || typeof p !== "object") return null;
    const score = (p as Record<string, unknown>).score;
    if (typeof score !== "number" || !Number.isFinite(score)) return null;
    out[key] = { score: Math.max(1, Math.min(10, Math.round(score))), note: clip((p as Record<string, unknown>).note, 160) };
  }
  return out;
}

/** The overall score is the plain mean of the six parts, rounded. No part is weighted over another. */
export function overallFromParts(parts: CriticParts): number {
  const sum = PART_KEYS.reduce((a, k) => a + parts[k].score, 0);
  return Math.max(1, Math.min(10, Math.round(sum / PART_KEYS.length)));
}

/**
 * Parses the critique of the FINISHED image and applies the caps in code. The overall score comes
 * from the six parts (their mean); an older single-score answer is still accepted. A visible stray
 * text, a halo or rectangle around the product, or a faded product caps the score at 4. Hard-to-read
 * text caps it at 5, awkward cropping at 6, and a generic look at 7, but only when the critic names
 * what is generic. A 9 or 10 needs a result with nothing flagged. When a cap holds the score down,
 * capReason says which one. Text printed on the real product (ignoreText) is never a defect.
 */
export function parseVisionCritique(raw: string, ignoreText: readonly string[] = []): VisionCritique {
  const j = safeJson<Record<string, unknown>>(raw);
  const parts = parseParts(j?.parts);
  if (!j || (!parts && typeof j.score !== "number")) {
    return { score: 5, rawScore: 5, parts: null, capReason: null, weakness: "The visual critique was unavailable this round.", fix: "", defects: [], notes: [], available: false };
  }
  const rawScore = parts ? overallFromParts(parts) : Math.max(1, Math.min(10, Math.round(j.score as number)));
  const strays = (Array.isArray(j.text_in_image) ? j.text_in_image.map((t) => clip(t, 40)).filter(Boolean) : []).filter((t) => !isProductText(t, ignoreText));
  const defects: string[] = [];
  if (strays.length) defects.push(`Text in the artwork: ${strays.slice(0, 3).map((t) => `"${t}"`).join(", ")}`);
  if (j.product_halo === true) defects.push("Halo or rectangle around the product");
  if (j.product_faded === true) defects.push("Product looks faded or transparent");
  // The product must be in the ad, all of it, uncut: each of these caps the score at 4.
  if (j.product_missing === true) defects.push("The product is missing from the ad");
  if (j.product_partial === true) defects.push("Only part of the product is shown");
  if (j.product_cut_off === true) defects.push("The product is cut off by the frame");
  const unseen = (Array.isArray(j.unseen_in_copy) ? j.unseen_in_copy.map((t) => clip(t, 30)).filter(Boolean) : []).slice(0, 3);
  if (unseen.length) defects.push(`The copy names something that cannot be seen in the ad: ${unseen.map((t) => `"${t}"`).join(", ")}`);

  // "Generic" only counts when the critic says exactly what is generic.
  const genericReason = clip(j.generic_reason, 120);
  const generic = j.generic_or_ai_look === true && genericReason.length > 0;
  const notes: string[] = [];
  if (j.awkward_crop === true) notes.push("Awkward cropping");
  if (j.illegible_text === true) notes.push("Text is hard to read");
  if (j.text_hidden_by_product === true) notes.push("Text is hidden by the product");
  if (generic) notes.push(`Looks generic: ${genericReason}`);

  const caps: { limit: number; reason: string }[] = [];
  if (defects.length) caps.push({ limit: DEFECT_CAP, reason: defects.join("; ") });
  if (j.illegible_text === true) caps.push({ limit: 5, reason: "text is hard to read" });
  if (j.text_hidden_by_product === true) caps.push({ limit: TEXT_HIDDEN_CAP, reason: "text is hidden by the product" });
  if (j.awkward_crop === true) caps.push({ limit: 6, reason: "awkward cropping" });
  if (generic) caps.push({ limit: 7, reason: `generic: ${genericReason}` });
  if (notes.length || defects.length) caps.push({ limit: 8, reason: notes[0] ?? defects[0] });

  let score = rawScore;
  let binding: { limit: number; reason: string } | null = null;
  for (const c of caps) {
    if (c.limit < score && (!binding || c.limit < binding.limit)) binding = c;
    score = Math.min(score, c.limit);
  }
  return {
    score,
    rawScore,
    parts,
    capReason: binding ? `Capped at ${binding.limit}: ${binding.reason}` : null,
    weakness: clip(j.biggest_weakness, 240),
    fix: clip(j.fix, 240),
    defects,
    notes,
    available: true,
  };
}

/**
 * Drops badge lines whose words already appear in the other text, so a fact is said once. The
 * model often repeats the offer in the badge, the subline and the call to action.
 */
export function dedupeBadge(badge: readonly string[], otherText: readonly string[]): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
  const haystack = otherText.map(norm).join(" | ");
  const joined = norm(badge.join(" "));
  if (!joined) return [];
  if (haystack.includes(joined)) return [];
  // Same words in a different order or with small words missing ("10% off Sparks Pocket" against
  // "10% off the Sparks Pocket this week") is still a repeat.
  const small = new Set(["the", "a", "an", "of", "on", "in", "for", "at", "to", "and", "with", "your", "our"]);
  const tokens = joined.split(" ").filter((w) => w && !small.has(w));
  const pool = new Set(haystack.split(/[ |]+/).filter(Boolean));
  if (tokens.length > 0 && tokens.every((w) => pool.has(w))) return [];
  return badge.filter((b) => b.trim());
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * True when a piece of text the critic reported is really printed on the product (a sticker, a logo
 * on a case). That text is part of the real product, so it must never count as stray text in the
 * generated background. Matches in either direction so "CIRCLES 2026" covers "Circles" and "2026".
 */
export function isProductText(found: string, productText: readonly string[]): boolean {
  const f = squash(found);
  if (!f) return false;
  return productText.some((p) => {
    const q = squash(p);
    return q.length > 0 && (q.includes(f) || f.includes(q));
  });
}

export interface ProductInspection {
  description: string;
  printedText: string[];
  visible: string[]; // colours, materials and parts clearly visible on the product
}

/** Reads the one-time look at the real product photo: what it is and any text printed on it. */
export function parseProductInspection(raw: string): ProductInspection {
  const j = safeJson<Record<string, unknown>>(raw);
  if (!j) return { description: "", printedText: [], visible: [] };
  const printed = Array.isArray(j.printed_text) ? j.printed_text.map((t) => clip(t, 60)).filter(Boolean).slice(0, 8) : [];
  const visible = Array.isArray(j.visible) ? j.visible.map((t) => clip(t, 30)).filter(Boolean).slice(0, 16) : [];
  return { description: clip(j.description, 160), printedText: printed, visible };
}

/** A short, neutral call to action for when the user gave none. It promises nothing the brief did not say. */
export function defaultCta(type: BriefType): string {
  return type === "product" ? "Shop now" : "Find out more";
}

/**
 * Drops detail rows whose words are already the headline or the subline, so a fact is shown once.
 * (A headline built from the offer, such as "Free with every ticket", must not repeat as a row.)
 */
export function dedupeDetails(details: readonly string[], otherText: readonly string[]): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
  const others = otherText.map(norm).filter(Boolean);
  return details.filter((d) => {
    const n = norm(d);
    return n && !others.some((o) => o.includes(n) || n.includes(o));
  });
}

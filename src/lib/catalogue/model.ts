// What a catalogue is made of, and the plain rules about it: which photos are ready, which need attention,
// what a finished ad needs a person to look at, how long a batch takes, and what an export holds.
// Pure and browser safe, so every rule here is unit tested.
import type { CatalogueRow } from "./csv.js";
import { csvLine, MAX_PRODUCTS } from "./csv.js";
import type { Concept, RunState } from "../../components/creative-director/runState.js";
import type { Override } from "./campaign.js";

export { MAX_PRODUCTS };
export const LOW_SCORE = 8; // a finished ad under this score needs a person's attention
export const BATCH_CONCURRENCY = 4;
export const MIN_MINUTES_PER_PRODUCT = 2; // one product's quick run, shortest and longest seen
export const MAX_MINUTES_PER_PRODUCT = 3;
export const MIN_SHORT_SIDE = 700; // a photo smaller than this, on its short side, is too small for a good ad

/** The yes or no answers from the photo check. */
export interface PhotoFlags {
  person_or_hand: boolean;
  several_products: boolean;
  visible_brand_or_logo: boolean;
  watermark: boolean;
  busy_background: boolean;
  low_resolution: boolean;
}
export const FLAG_KEYS = ["person_or_hand", "several_products", "visible_brand_or_logo", "watermark", "busy_background", "low_resolution"] as const;

export interface PhotoCheck {
  ran: boolean; // false when the check itself failed
  flags: PhotoFlags | null;
  width: number;
  height: number;
  via: string | null; // which model answered, in words
}

export type Approval = "pending" | "approved" | "rejected";
export type RunStatus = "idle" | "queued" | "running" | "done" | "failed" | "not_run";

export interface CatalogueItem {
  id: string;
  row: CatalogueRow;
  photoUrl: string; // for showing the original
  check: PhotoCheck | null;
  checkStatus: "waiting" | "checking" | "done";
  runAnyway: boolean;
  runStatus: RunStatus;
  run: RunState | null; // the existing run state, so the existing reducer and the revise flow are reused
  progress: string; // one plain line while it runs
  error: string | null;
  approval: Approval;
  rescued?: boolean; // "Try anyway" was clicked for this photo: its runs use the rescue path
  notice?: string | null; // a short plain sentence on the card, for example that another revision is running
  working?: string | null; // set while a revision or a new effect is being made, so the card can say so
  override?: Override; // this product's own Look or Effect, over the campaign's
}

/** One plain sentence for a flag that is yes. */
export function flagSentence(key: keyof PhotoFlags, check: PhotoCheck): string {
  switch (key) {
    case "person_or_hand": return "A person or a hand is in the shot.";
    case "several_products": return "The photo shows several products, so it is not clear which one to advertise.";
    case "visible_brand_or_logo": return "A brand name or logo is visible.";
    case "watermark": return "There is a watermark.";
    case "busy_background": return "The background is busy, which makes the product hard to cut out.";
    case "low_resolution": return `The photo is small (${check.width} by ${check.height}), so the ad may look soft.`;
  }
}

/** Why a photo needs attention before any credits are spent, in plain sentences. Empty when it is ready. */
export function attentionReasons(check: PhotoCheck | null): string[] {
  if (!check) return [];
  if (!check.ran || !check.flags) return ["The photo check did not work, so this one is held back."];
  const flags = check.flags;
  return FLAG_KEYS.filter((k) => flags[k]).map((k) => flagSentence(k, check));
}

/** The photo-size rule, done in code from the real pixels, because a model cannot see the file's resolution. */
export const isLowResolution = (width: number, height: number): boolean => Math.min(width, height) < MIN_SHORT_SIDE;

export const isChecked = (item: CatalogueItem): boolean => item.checkStatus === "done";

/** The product name is empty or still marked "to be added". Ticking Run anyway does not cover this: an ad needs a name. */
export const nameMissing = (item: Pick<CatalogueItem, "row">): boolean => {
  const name = item.row.product.trim().toLowerCase();
  return name === "" || name === "to be added";
};
export const NAME_MISSING_SENTENCE = "The product name is still to be added. Type it in before making an ad.";

/** Every reason this product is held back before a run, in plain sentences. */
export const holdReasons = (item: CatalogueItem): string[] => [...(nameMissing(item) ? [NAME_MISSING_SENTENCE] : []), ...attentionReasons(item.check)];
export const needsAttentionBeforeRun = (item: CatalogueItem): boolean => isChecked(item) && holdReasons(item).length > 0;
/** A product is ready to make an ad for when it has a name and its check is clean, or the person ticked Run anyway for the photo problems. */
export const isReady = (item: CatalogueItem): boolean => isChecked(item) && !nameMissing(item) && (item.runAnyway || attentionReasons(item.check).length === 0);
/** The products the batch will run: ready ones not yet made, and never more than MAX_PRODUCTS. */
export const readyItems = (items: readonly CatalogueItem[]): CatalogueItem[] =>
  items.filter((i) => isReady(i) && (i.runStatus === "idle" || i.runStatus === "not_run" || i.runStatus === "failed")).slice(0, MAX_PRODUCTS);

/** The batch time as a range in whole minutes: products run four at a time, each taking 2 to 3 minutes. */
export function estimateRange(products: number): { low: number; high: number } {
  const waves = Math.ceil(products / BATCH_CONCURRENCY);
  return { low: waves * MIN_MINUTES_PER_PRODUCT, high: waves * MAX_MINUTES_PER_PRODUCT };
}
export const estimateText = (products: number): string => {
  const { low, high } = estimateRange(products);
  return `about ${low} to ${high} minutes for ${products} product${products === 1 ? "" : "s"}`;
};

// ---- a finished ad ---------------------------------------------------------------------------------

export function finalConcept(item: Pick<CatalogueItem, "run">): Concept | null {
  const run = item.run;
  if (!run || run.finalPickIndex === null) return null;
  return run.concepts[run.finalPickIndex] ?? null;
}

/** Plain words about a finished ad: the problems a person should look at before approving. */
export function resultProblems(item: CatalogueItem): string[] {
  const c = finalConcept(item);
  if (!c) return item.error ? [item.error] : [];
  const out: string[] = [];
  if (!c.folioCheck.passed) out.push(`A claim was blocked: ${c.folioCheck.reason ?? "it was not an approved fact"}.`);
  if (!c.fidelity.sameProduct) out.push(`The product in the ad may not match your photo${c.fidelity.differences.length ? `: ${c.fidelity.differences.join(", ")}` : ""}.`);
  if (c.defects.length) out.push(`The reviewer found: ${c.defects.join("; ")}.`);
  else if (c.breakdown?.capReason) out.push(`${c.breakdown.capReason}.`);
  if (c.score < LOW_SCORE) out.push(`The score is ${c.score} out of 10, under ${LOW_SCORE}.`);
  return out;
}

/** True for a finished ad that needs a look: a low score or any problem. */
export const resultNeedsAttention = (item: CatalogueItem): boolean => item.runStatus === "done" && resultProblems(item).length > 0;

/** Which model did the critic step for the final pick, in plain words, and whether it was the first choice. */
export function criticLine(c: Concept): string {
  const use = c.models?.find((m) => m.step === "critic");
  if (!use) return "The reviewing step did not report which model it used.";
  if (!use.fellBack) return `Scored by a separate reviewing step: ${use.label}.`;
  return `Scored by a separate reviewing step: ${use.label}. The first choice could not answer${use.reason ? ` (${use.reason})` : ""}, so this one stepped in.`;
}

// ---- export ----------------------------------------------------------------------------------------

export interface ExportRow {
  sku: string;
  product: string;
  status: "approved";
  score: number;
  reason: string;
  fileName: string;
  imageB64: string;
}

/** Only approved ads go into the export. The reason says what the person was told about the ad. */
export function exportRows(items: readonly CatalogueItem[]): ExportRow[] {
  const out: ExportRow[] = [];
  for (const item of items) {
    if (item.approval !== "approved") continue;
    const c = finalConcept(item);
    if (!c || !c.imageB64) continue;
    const problems = resultProblems(item);
    out.push({
      sku: item.row.sku,
      product: item.row.product,
      status: "approved",
      score: c.score,
      reason: problems.length ? `Approved by a person despite: ${problems.join(" ")}` : "Approved by a person",
      fileName: `${item.row.sku}.jpg`,
      imageB64: c.imageB64,
    });
  }
  return out;
}

export function resultsCsv(rows: readonly ExportRow[]): string {
  return [csvLine(["sku", "product", "status", "score", "reason"]), ...rows.map((r) => csvLine([r.sku, r.product, r.status, r.score, r.reason]))].join("\n") + "\n";
}

// ---- groups, the biggest problem, and the results table ---------------------------------------------

/**
 * Where a product sits on the page.
 *   held     stopped before any ad was made, with the reason
 *   check    a finished ad under 8
 *   ready    a finished ad at 8 or more, and anything a person approved
 *   pending  not made yet (waiting, queued or running)
 */
export type Group = "approved" | "held" | "check" | "ready" | "pending";

export const GROUP_LABEL: Record<Exclude<Group, "pending">, string> = { approved: "Approved", held: "Held back", check: "Check these", ready: "Ready" };

/** True while the product is being made, revised or restyled: the card says so and its buttons are off. */
export const isWorking = (item: Pick<CatalogueItem, "runStatus" | "working">): boolean => item.runStatus === "running" || item.runStatus === "queued" || !!item.working;

export function groupOf(item: CatalogueItem): Group {
  const c = finalConcept(item);
  // A card with an ad already on it stays in its group while it is revised, so it does not jump into "Not made yet".
  const live = item.runStatus === "running" || item.runStatus === "queued";
  if ((item.runStatus === "done" || live) && c) {
    if (item.approval === "approved") return "approved";
    // A new effect was drawn after the critic looked: the score is out of date, so a person has to look.
    if (c.unreviewed) return "check";
    // Under 8 needs a look. So does a blocked claim or a product that does not match, whatever the score says.
    return c.score >= LOW_SCORE && c.folioCheck.passed && c.fidelity.sameProduct ? "ready" : "check";
  }
  if (item.runStatus === "failed" || item.runStatus === "not_run") return "held";
  if (item.runStatus === "idle" && needsAttentionBeforeRun(item) && !isReady(item)) return "held";
  return "pending";
}

/** Why a held product has no ad, in plain words. */
export function heldReasons(item: CatalogueItem): string[] {
  if (item.runStatus === "failed") return [item.error ?? "This product did not finish."];
  if (item.runStatus === "not_run") return ["The batch stopped before this product, so no ad was made."];
  return holdReasons(item);
}

const PART_WORDS: Record<string, string> = {
  legibility: "Hard to read",
  hierarchy: "Unclear what to read first",
  composition: "Layout",
  brandfit: "Does not suit the brand",
  fidelity: "Product",
  originality: "Looks generic",
};

const sentence = (s: string): string => {
  const t = s.trim().replace(/\s+/g, " ");
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
};

/** The critic's weakness with its part name turned into plain words: "originality - familiar layout" becomes "Looks generic: familiar layout." */
export function plainWeakness(weakness: string): string {
  const m = weakness.trim().match(/^(legibility|hierarchy|composition|brand ?fit|fidelity|originality)\b\s*(?:[:\-–—]|\bis\b|\bat\b)?\s*(.*)$/i);
  if (!m) return sentence(weakness);
  const rest = m[2].trim();
  const label = PART_WORDS[m[1].toLowerCase().replace(/\s/g, "")] ?? m[1];
  return rest ? sentence(`${label}: ${rest}`) : sentence(label);
}

/**
 * The single biggest problem with a finished ad, in plain words, for the Check these group. The hard failures that
 * capped the score come first (a blocked claim, a product that does not match, the product cut off or missing), then the
 * critic's weakest point, then the lowest scored part. It never just repeats the score.
 */
export function biggestProblem(c: Concept): string {
  if (c.unreviewed) return c.unreviewed;
  if (!c.folioCheck.passed) return sentence(`A claim was blocked: ${c.folioCheck.reason ?? "it was not an approved fact"}`);
  if (!c.fidelity.sameProduct) return sentence(`The product in the ad may not match your photo${c.fidelity.differences.length ? `: ${c.fidelity.differences.join(", ")}` : ""}`);
  if (c.defects.length) return sentence(c.defects[0]);
  if (c.weakness?.trim()) return plainWeakness(c.weakness);
  const parts = c.breakdown?.parts;
  if (parts) {
    const [key, p] = Object.entries(parts).sort((a, b) => a[1].score - b[1].score)[0];
    return sentence(`${PART_WORDS[key.toLowerCase()] ?? key}: ${p.note || `scored ${p.score} out of 10`}`);
  }
  return "The reviewer scored it under 8 without naming one problem.";
}

/** The problem line for any group: the biggest problem for a finished ad under 8, the reason for a held product. */
export function problemLine(item: CatalogueItem): string | null {
  const g = groupOf(item);
  if (g === "held") return heldReasons(item)[0] ?? null;
  const c = finalConcept(item);
  return g === "check" && c ? biggestProblem(c) : null;
}

/** Which model reviewed the final ad, in words, with the fallback marked. */
export function reviewerLabel(c: Concept | null): string {
  const use = c?.models?.find((m) => m.step === "critic");
  if (!use) return "not reported";
  return use.fellBack ? `${use.label} (fallback)` : use.label;
}

export interface TableRow {
  file: string;
  product: string;
  headline: string;
  score: string;
  group: string;
  reviewer: string;
}

/** One row per product that has an outcome (a finished ad or a held product). Products not made yet are left out. */
export function resultRows(items: readonly CatalogueItem[]): TableRow[] {
  const rows: TableRow[] = [];
  for (const item of items) {
    const g = groupOf(item);
    if (g === "pending") continue;
    const c = finalConcept(item);
    rows.push({
      file: item.row.image,
      product: item.row.product,
      headline: c?.headline ?? "",
      score: c ? `${c.score}/10` : "",
      group: GROUP_LABEL[g],
      reviewer: c ? reviewerLabel(c) : "",
    });
  }
  return rows;
}

/**
 * The round of an ad, counted for this ad alone: the first ad is round 1, and each revision that actually ran adds one.
 * A request that never ran adds nothing.
 */
export const adRound = (concepts: ReadonlyArray<{ revisionOf?: unknown }>): number => 1 + concepts.filter((c) => !!c.revisionOf).length;

/** "12 s" under a minute, "7 min 46 s" above it. */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`;
}

export interface BulkPlan {
  redraw: CatalogueItem[]; // finished ads that will be redrawn
  byHand: CatalogueItem[]; // skipped: the person set this ad's effect by hand (Try another effect, or a per-product effect)
  photographs: CatalogueItem[]; // skipped: a photographic scene or a whole photo, which has no separate background to restyle
  busy: CatalogueItem[]; // skipped: being made or revised right now
}

/** Which finished ads an "Effect for all ads" change reaches. It asks nothing: ads set by hand are left alone and counted. */
export function bulkPlan(items: readonly CatalogueItem[]): BulkPlan {
  const plan: BulkPlan = { redraw: [], byHand: [], photographs: [], busy: [] };
  for (const item of items) {
    const c = finalConcept(item);
    if (!c || item.runStatus !== "done" && item.runStatus !== "running" && item.runStatus !== "queued") continue;
    if (isWorking(item)) plan.busy.push(item);
    else if (c.manualEffect || item.override?.effect) plan.byHand.push(item);
    else if (!c.style?.effectable || !item.run?.cutoutB64) plan.photographs.push(item);
    else plan.redraw.push(item);
  }
  return plan;
}

/** The plain sentence that says what a change for all ads did. */
export function bulkSummary(done: number, failed: number, plan: BulkPlan, ms?: number): string {
  const parts = [`Redrew ${done} ad${done === 1 ? "" : "s"}${ms === undefined ? "" : ` in ${durationText(ms)}`}`];
  if (failed) parts.push(`${failed} could not be redrawn`);
  if (plan.byHand.length) parts.push(`${plan.byHand.length} skipped because you set ${plan.byHand.length === 1 ? "its effect" : "their effects"} by hand`);
  if (plan.photographs.length) parts.push(`${plan.photographs.length} skipped because effects apply to cut-out ads only (${plan.photographs.length === 1 ? "it uses the whole photo" : "they use the whole photo or a photographic scene"})`);
  if (plan.busy.length) parts.push(`${plan.busy.length} skipped because ${plan.busy.length === 1 ? "it is" : "they are"} being made`);
  return `${parts.join(". ")}. Scores are out of date until you revise an ad.`;
}

/**
 * The Demo set: eight rows of the sample catalogue, in the order the demo shows them. Five make ads, the steel flask is the one to use
 * Try anyway on when its photo is held back, busy-background is for Find items in this photo, and pouch-in-hand (a hand) shows the refusal.
 */
export const DEMO_SKUS: readonly string[] = ["mug-white", "tote-jute", "lamp-table", "stool-wooden", "notebook-black", "flask-steel", "busy-background", "pouch-in-hand"];

/** The demo rows out of a catalogue's rows, in demo order. Rows that are missing are left out. */
export function pickDemoRows<T extends { sku: string }>(rows: readonly T[]): T[] {
  return DEMO_SKUS.map((sku) => rows.find((r) => r.sku === sku)).filter((r): r is T => !!r);
}

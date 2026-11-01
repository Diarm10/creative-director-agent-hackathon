// The Creative Director loop, written for this repo.
//
// A run is one setup (for a product brief, SAM cuts the real product out of the photo) followed by up to
// three rounds. Each round plans the copy and layout, makes the picture, draws the type with the layout
// engine, then runs three checks side by side: is it still the real product, do the brand rules hold, and
// what does a critic looking at the finished image score it. The critic's weakest point feeds the next
// plan. runRevision adds one more round on a round the person has given feedback on.
// Text and vision steps go through the provider layer (providers.ts); images and SAM stay on Meta.
import sharp from "sharp";
import { ImageBudget, MODELS } from "./client.js";
import { createModelCaller, createRouterFromEnv, type ModelCaller, type Router } from "./providers.js";
import { cutOutProduct, type ProductCutout } from "./segment.js";
import { memoryNote } from "./memory.js";
import { quoteAsData, sanitizeFeedbackText } from "./feedbackSafety.js";
import type { ProductInspection } from "./creativeDirectorPure.js";
import { unseenTerms } from "./visibleCopy.js";
import { applyScaleChange, SCALE_LIMITS, applyFidelityGate, applyFolioGate, checkFolioCompliance, cleanCopy, defaultCta, parsePlan, parseProductInspection, parseVisionCritique, pickFinalRoundIndex, safeJson, isAudienceHeadline, mentionsAudience } from "./creativeDirectorPure.js";
import type { BriefType, FolioGuardrails, PlanArchetype, RoundPlan, TextCaller, VisionCritique } from "./creativeDirectorPure.js";
import { decideAfterRound, describeEnd, type StopReason } from "./runEnd.js";
import { HEAD_SCALE_LIMITS, PRODUCT_SCALE_LIMITS, SCALE_STEP_LAYOUT, inferSpacingChange, layoutIntent, type LayoutIntent, type RevisionRequest } from "./revision.js";
import { lookOf } from "./look.js";
import { styleChoice } from "./visuals.js";
import { RESCUE_NOT_SEPARATED } from "./rescue.js";
import { lookById } from "./looks.js";
import { styleFor, styleVoice, stripScenery, type Style } from "./style.js";
import { copyProblems } from "./themes.js";
import { anglesFor, bannedReason, buttonFor, copyPrompt, copyRuleBreak, kindOf, occasionLine, parseCandidates, parseSense, rankCandidates, retryNote, SAFE_LINES, sensePrompt, givenSubline, type Candidate } from "./adCopy.js";
import { STYLISED_NOTE } from "./design/effects.js";
import { directionForRound, type Direction } from "./directions.js";
import { cutoutWorks } from "./cutoutCheck.js";
import { adjustScore, measureQuality } from "./quality.js";
import { COMPLETE_PROMPT, cutoutSanity, parseComplete, partialNote, photoAsPanel, PANEL_NOTE } from "./cutoutSanity.js";

/** What the person is told when their note asked for the whole product and the cut-out itself was fine. */
const ASKED_PANEL_NOTE = "As you asked, the whole original photo is shown.";
import {
  PLANNER_SYSTEM, buildCritiquePrompt, fidelityPrompt, inspectionPrompt, planPrompt, runFacts, suppliedDetails, type CritiqueContext, type Feedback, type MeasuredLayout, MASTHEAD_NOTE, STICKER_NOTE, TYPE_BEHIND_NOTE,
} from "./prompts.js";
import { buildGraphicVisual, buildProductVisual, designCopy } from "./visuals.js";
import type { Brief, Concept, CreativeChannel, CreativeResult, EventSink, Fidelity, FolioCheck } from "./brief.js";

export { suppliedDetails, buildCritiquePrompt };
export type { Brief, Concept, CreativeChannel, CreativeResult, CreativeDirectorEvent, EventSink } from "./brief.js";

const MAX_ROUNDS = 3;
const COPY_CAP = 5;
const GAP_STEP = 1.6; // a spacing note moves the composition by a clear step, not a few pixels
const SCORE_CAP = 4;
const THUMBNAIL_PX = 256;
const JPEG_QUALITY = 80;

const noopSink: EventSink = () => {};

const toJpegB64 = async (image: Buffer): Promise<string> =>
  (await sharp(image).flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY }).toBuffer()).toString("base64");

const asJpegUrl = async (img: Buffer): Promise<string> =>
  `data:image/jpeg;base64,${(await sharp(img).resize({ width: 1024, height: 1024, fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer()).toString("base64")}`;

function folioGuardrails(brief: Brief): FolioGuardrails | null {
  return brief.folio ? { bannedWords: brief.folio.bannedWords, bannedClaims: brief.folio.bannedClaims, approvedFacts: brief.folio.approvedFacts } : null;
}

/** The folio check's text caller, routed through the provider layer as the "folio" step. */
const folioCaller = (ai: ModelCaller): TextCaller => (input, instructions, opts) =>
  ai.text("folio", input, instructions, { temperature: opts?.temperature, expectJson: true });

// ---- Plan and checks -------------------------------------------------------------------------

const titleCase = (s: string): string => s.trim().split(/\s+/).slice(0, 5).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** What the product image shows, for the planner and the checks on its copy. */
interface Seen {
  visible: string; // the image's description
  seen: string; // everything that counts as visible, as one string
  details: string[]; // concrete visible details, for a headline that must use one
}

const NO_SEEN: Seen = { visible: "", seen: "", details: [] };

/** A headline from a visible detail of the product, used when the planner will not write a new one. */
function detailHeadline(brief: Brief, details: readonly string[], earlier: string): string {
  const noun = (brief.productNoun ?? "").trim();
  const have = new Set(noun.toLowerCase().split(/\s+/));
  for (const d of details) {
    const detail = d.trim();
    if (!detail || detail.toLowerCase().split(/\s+/).every((w) => have.has(w))) continue;
    const text = titleCase(`${detail} ${noun}`);
    if (text.toLowerCase() !== earlier.toLowerCase()) return text;
  }
  return titleCase(noun) || earlier;
}

async function planRound(brief: Brief, type: BriefType, allowed: readonly PlanArchetype[], fb: Feedback | null, ai: ModelCaller, revision: RevisionRequest | null, direction: Direction | null, look: Seen = NO_SEEN, intent: LayoutIntent | null = null, panel = false, style: Style | null = null, lines: Candidate | null = null): Promise<RoundPlan> {
  const { visible, seen } = look;
  const generic =
    intent?.newHeadline && revision
      ? `\n\nThe person called the earlier design generic. Write a NEW headline that is different from "${revision.headline}" and uses one concrete detail of the product, such as one of: ${look.details.slice(0, 6).join(", ") || visible || "its shape or material"}. Reply as JSON.`
      : "";
  const prompt = planPrompt(brief, type, allowed, fb, revision, direction, visible, style ? styleVoice(style) : "") + generic;
  const fallbackHeadline = brief.title || brief.offer || brief.clientName;
  let plan = parsePlan(await ai.text("planner", prompt, PLANNER_SYSTEM, { expectJson: true }), allowed, fallbackHeadline);
  // The ad lines come from the copy engine (checked in code); the planner still decides the layout, the scene and the colours.
  if (lines) {
    plan.headline = lines.headline;
    plan.subline = lines.subline;
  } else if (type === "product" && !revision) {
    // The copy engine could not run: the planner's own subline is dropped. Only a fact or offer the person gave, or a gifting theme's occasion line, is used.
    plan.subline = givenSubline([brief.offer, brief.facts, ...(brief.folio?.approvedFacts ?? [])], { productNoun: brief.productNoun ?? "", visible: look.visible, facts: brief.facts }) || occasionLine(style?.theme?.id, brief.productNoun ?? "", brief.copyIndex ?? 0);
  }
  // A headline that is only the audience is rejected and rewritten once; if it comes back the same, the product name is used.
  if (type === "product" && !revision && isAudienceHeadline(plan.headline, brief.audience)) {
    const again = prompt + `\n\nYour headline "${plan.headline}" is only the audience. Rewrite it from the product or a fact. Reply as JSON again.`;
    plan = parsePlan(await ai.text("planner", again, PLANNER_SYSTEM, { expectJson: true }), allowed, fallbackHeadline);
    if (isAudienceHeadline(plan.headline, brief.audience) && brief.productNoun) plan.headline = titleCase(brief.productNoun);
  }
  // Neither the headline nor the subline may name the audience: that is what makes every ad read as the same template.
  if (type === "product" && !revision && (mentionsAudience(plan.headline, brief.audience, brief.productNoun) || mentionsAudience(plan.subline, brief.audience, brief.productNoun))) {
    const again = prompt + `\n\nYour headline "${plan.headline}" or subline "${plan.subline}" names the audience. Rewrite both from the product itself or one of the facts, without naming who it is for. Reply as JSON again.`;
    plan = parsePlan(await ai.text("planner", again, PLANNER_SYSTEM, { expectJson: true }), allowed, fallbackHeadline);
    if (mentionsAudience(plan.headline, brief.audience, brief.productNoun)) plan.headline = SAFE_LINES[kindOf(brief.productNoun ?? "")].headline;
    if (mentionsAudience(plan.subline, brief.audience, brief.productNoun)) plan.subline = (brief.facts ?? "").trim().split(/[.;]/)[0].slice(0, 70);
  }
  // The copy may only name a colour, material or part that the product image shows. A fact the shop typed does not make it visible.
  if (type === "product" && seen) {
    const claimed = () => unseenTerms(`${plan.headline}. ${plan.subline}`, seen);
    const first = claimed();
    if (first.length) {
      console.warn(`[loop] the copy names ${first.join(", ")}, which the product image does not show: asking for a rewrite`);
      const again = prompt + `\n\nYour headline or subline names ${first.join(", ")}, which cannot be seen in the product image (it shows: ${quoteAsData(sanitizeFeedbackText(visible, 160))}). Rewrite them using only what is visible. Reply as JSON again.`;
      plan = parsePlan(await ai.text("planner", again, PLANNER_SYSTEM, { expectJson: true }), allowed, fallbackHeadline);
      if (unseenTerms(plan.headline, seen).length) plan.headline = SAFE_LINES[kindOf(brief.productNoun ?? "")].headline;
      if (unseenTerms(plan.subline, seen).length) plan.subline = "";
    }
  }
  // The occasion comes from palette, layout and copy. The words may not state a figure the person did not type, or claim scarcity or a
  // delivery date, and the scene prompt never carries seasonal props.
  if (type === "product") {
    const allowedText = [brief.offer, brief.facts, brief.clientName, brief.cta, ...(brief.folio?.approvedFacts ?? [])].filter(Boolean).join(" ");
    const problems = () => copyProblems([plan.headline, plan.subline, ...plan.badge, plan.cta].join(". "), allowedText);
    const first = problems();
    if (first.length) {
      console.warn(`[loop] the copy broke a rule (${first.join("; ")}): asking for a rewrite`);
      const again = prompt + `\n\nYour copy broke a rule: ${first.join("; ")}. Rewrite the headline, subline, badge and call to action without any figure, date or code that is not in the facts or the offer, and with no scarcity or delivery claim. Reply as JSON again.`;
      plan = parsePlan(await ai.text("planner", again, PLANNER_SYSTEM, { expectJson: true }), allowed, fallbackHeadline);
      if (problems().length) {
        plan.headline = detailHeadline(brief, look.details, "") || titleCase(brief.productNoun ?? "") || plan.headline;
        plan.subline = "";
        plan.badge = [];
        plan.cta = "";
      }
    }
    if (style?.theme) plan.artPrompt = stripScenery(plan.artPrompt);
    // Without the copy engine's lines (the model could not be reached), a planner headline that breaks a banned pattern is replaced by a
    // plain safe line for the product type: never "Give This X", never just the product name, never a word from the name as the hook.
    if (!lines) {
      // Only the two patterns that must never reach an ad are replaced here: "Give This X" / "Gift This X", and a headline that is only the product name.
      const why = [bannedReason({ angle: "verb", headline: plan.headline, subline: "" }, { productNoun: brief.productNoun ?? "" })].filter((w) => w && /Give This|just the product name/.test(w))[0];
      if (why) {
        console.warn(`[loop] the planner's headline "${plan.headline}" is not allowed (${why}): using a plain line`);
        // A revision keeps the words of the ad it started from; a first run uses the plain line for the product type.
        const safe = SAFE_LINES[kindOf(brief.productNoun ?? "")];
        plan.headline = revision ? revision.headline : safe.headline;
        plan.subline = revision ? revision.subline : safe.subline;
      }
    }
  }
  // A direction fixes the composition of a typographic design, so the three rounds really differ.
  if (direction?.variant && plan.archetype === "typographic") plan.variant = direction.variant;
  // The person's call to action wins; otherwise the planner's; otherwise a short neutral default.
  if (brief.cta) plan.cta = cleanCopy({ headline: brief.cta, body: "" }).headline;
  else if (style?.theme) plan.cta = buttonFor(style.theme.id, style.theme.cta, brief.productNoun ?? "");
  else if (!plan.cta) plan.cta = defaultCta(type);
  // A revision starts from the earlier round's sizes and moves them by what the planner asked for.
  if (revision && intent) {
    // A new headline when the note called the design generic: it must differ from the earlier one and use a product detail.
    if (intent.newHeadline) {
      const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      if (same(plan.headline, revision.headline)) {
        const again = prompt + `\n\nYour headline "${plan.headline}" is the same as the earlier one. Write a different headline that uses a concrete detail of the product. Reply as JSON again.`;
        plan = parsePlan(await ai.text("planner", again, PLANNER_SYSTEM, { expectJson: true }), allowed, fallbackHeadline);
      }
      if (same(plan.headline, revision.headline) || (seen && unseenTerms(plan.headline, seen).length)) plan.headline = detailHeadline(brief, look.details, revision.headline);
      if (!same(plan.headline, revision.headline)) plan.applied.push("wrote a new headline from a detail of the product");
    }
    // The layout levers a note can pull: how tight the overlap limit is, and how large the product and the headline are.
    const behind = allowed[0] === "behind";
    const sized = allowed[0] === "behind" || allowed[0] === "product";
    plan.overlapGuard = Math.min(4, revision.plan.overlapGuard + (behind ? intent.guardSteps : 0));
    if (intent.guardSteps && behind) plan.applied.push("tightened the limit on how much of the headline the product may cover");
    if (intent.guardSteps && !behind) plan.ignored.push("this layout has no type behind the product to uncover");
    const dir = (n: -1 | 0 | 1) => (n > 0 ? "larger" : n < 0 ? "smaller" : "same");
    plan.productScale = sized ? applyScaleChange(revision.plan.productScale, dir(intent.product), PRODUCT_SCALE_LIMITS, SCALE_STEP_LAYOUT) : revision.plan.productScale;
    plan.headScale = sized ? applyScaleChange(revision.plan.headScale, dir(intent.headline), HEAD_SCALE_LIMITS, SCALE_STEP_LAYOUT) : revision.plan.headScale;
    // Said only when the scale really moved: a scale already at its limit is not a change.
    if (intent.product && sized) (plan.productScale !== revision.plan.productScale ? plan.applied : plan.ignored).push(plan.productScale !== revision.plan.productScale ? `made the product ${dir(intent.product)}` : `the product is already at the ${intent.product > 0 ? "largest" : "smallest"} size allowed`);
    if (intent.headline && sized) (plan.headScale !== revision.plan.headScale ? plan.applied : plan.ignored).push(plan.headScale !== revision.plan.headScale ? `made the headline ${dir(intent.headline)}` : `the headline already fills the width, so it cannot get larger`);
    if ((intent.product || intent.headline) && !sized) plan.ignored.push("the size cannot be changed in a photographic scene");
    if (intent.wholePhoto) (panel ? plan.applied : plan.ignored).push(panel ? "showed the whole original photo" : "the whole photo could not be used");
    for (const clause of intent.unmatched) plan.ignored.push(`no layout change matches "${clause}"`);
    plan.ctaScale = applyScaleChange(revision.plan.ctaScale, plan.ctaChange, SCALE_LIMITS.cta);
    // When the note or the critic's fix is about the gap, the layout changes even if the planner left spacing alone.
    const spacing = plan.gapChange !== "same" ? plan.gapChange : inferSpacingChange(revision);
    plan.gapScale = applyScaleChange(revision.plan.gapScale, spacing, SCALE_LIMITS.gap, GAP_STEP);
    if (plan.ctaScale !== revision.plan.ctaScale) plan.applied.push(`made the button ${plan.ctaScale > revision.plan.ctaScale ? "larger" : "smaller"}`);
    if (plan.gapScale !== revision.plan.gapScale) plan.applied.push(`${plan.gapScale < revision.plan.gapScale ? "tightened" : "loosened"} the spacing`);
    if (plan.headline !== revision.headline) plan.applied.push("changed the headline wording");
    if (plan.subline !== revision.subline) plan.applied.push("changed the subline wording");
  }
  return plan;
}

/** Real product against the generated scene. An inconclusive check is not evidence of a mismatch, so it fails open. */
async function checkFidelity(productPng: Buffer, adImage: Buffer, productText: readonly string[], ai: ModelCaller, shapeOnly = false): Promise<Fidelity> {
  try {
    const productUrl = `data:image/png;base64,${(await sharp(productPng).resize({ width: 768, height: 768, fit: "inside" }).png().toBuffer()).toString("base64")}`;
    const out = await ai.vision("fidelity", fidelityPrompt(productText, shapeOnly), [productUrl, await asJpegUrl(adImage)], { expectJson: true });
    const parsed = safeJson<{ sameProduct: boolean; differences: string[] }>(out);
    return parsed ? { sameProduct: !!parsed.sameProduct, differences: parsed.differences ?? [] } : { sameProduct: true, differences: [] };
  } catch (e) {
    console.warn("[loop] fidelity check failed, assuming a match:", e instanceof Error ? e.message : e);
    return { sameProduct: true, differences: [] };
  }
}

/** A critic's look at the FINISHED image. Never a flat 10: caps are applied in parseVisionCritique. */
export async function critiqueImage(
  finished: Buffer, intendedText: string[], hasProduct: boolean, audience: string, productText: readonly string[], ctx: CritiqueContext, ai: ModelCaller,
): Promise<VisionCritique> {
  try {
    // Temperature 0 so the same image gets the same score; the provider layer retries without it if refused.
    const out = await ai.vision("critic", buildCritiquePrompt(intendedText, hasProduct, audience, productText, ctx), [await asJpegUrl(finished)], { temperature: 0, expectJson: true });
    return parseVisionCritique(out, [...productText, ...(ctx.ignoreText ?? [])]);
  } catch (e) {
    console.warn("[loop] the critique failed:", e instanceof Error ? e.message : e);
    return parseVisionCritique("");
  }
}

/** What the real product is, and any text printed on it. That text is the product's, not stray text. Fails open. */
async function inspectProduct(productPng: Buffer, ai: ModelCaller): Promise<ProductInspection> {
  try {
    const flat = await sharp(productPng).resize({ width: 1024, height: 1024, fit: "inside" }).flatten({ background: "#ffffff" }).png().toBuffer();
    return parseProductInspection(await ai.vision("fidelity", inspectionPrompt(), [`data:image/png;base64,${flat.toString("base64")}`], { expectJson: true }));
  } catch (e) {
    console.warn("[loop] product inspection failed, assuming no printed text:", e instanceof Error ? e.message : e);
    return { description: "", printedText: [], visible: [] };
  }
}

/** Why the overall score is what it is, when a cap held it down. A product mismatch or folio block wins when it is the one that bit. */
function capReasonFor(c: VisionCritique, fidelity: Fidelity, folio: FolioCheck): string | null {
  if (!folio.passed && c.score > SCORE_CAP) return `Capped at ${SCORE_CAP}: blocked by folio${folio.reason ? `, ${folio.reason}` : ""}`;
  if (!fidelity.sameProduct && c.score > SCORE_CAP) {
    return `Capped at ${SCORE_CAP}: the product differs from the real one${fidelity.differences.length ? `, ${fidelity.differences.join(", ")}` : ""}`;
  }
  return c.capReason;
}

// ---- Setup and one round ---------------------------------------------------------------------

interface RunSetup {
  type: BriefType;
  channel: CreativeChannel;
  cutout: ProductCutout | null;
  inspection: Promise<ProductInspection>;
  allowed: readonly PlanArchetype[];
  guardrails: FolioGuardrails | null;
  behindOk: boolean; // false when the cut-out is not clean enough to set type behind the product
  panel: boolean; // true when the cut-out failed its sanity check: the whole original photo is used on the studio layout
  copy?: Promise<{ best: Candidate; others: Candidate[] } | null>; // the ad lines for this product, made once and used by every round
}

/**
 * The ad lines for one product: three candidates from different angles, checked in code, the best first. One retry when too few
 * pass, then the next candidate, then a plain safe line for the product type. Null only when the model cannot be reached at all.
 */
async function adLines(brief: Brief, ai: ModelCaller, style: Style, visible: string): Promise<{ best: Candidate; others: Candidate[] } | null> {
  const noun = brief.productNoun ?? "";
  const angles = anglesFor(style.theme?.id);
  // The facts the lines may draw on: the catalogue row's fact and the folio's approved claims.
  const factsText = [brief.facts, ...(brief.folio?.approvedFacts ?? [])].filter(Boolean).join(". ");
  const ctx = { productNoun: noun, visible, audience: brief.audience, facts: [factsText, brief.offer].filter(Boolean).join(". "), avoid: brief.copyAvoid, preferAngle: angles[(brief.copyIndex ?? 0) % angles.length] };
  const occasion = occasionLine(style.theme?.id, noun, brief.copyIndex ?? 0);
  const allowedText = [brief.offer, brief.facts, brief.clientName, brief.cta, ...(brief.folio?.approvedFacts ?? [])].filter(Boolean).join(" ");
  const ask = async (extra: string): Promise<Candidate[]> => {
    const prompt = copyPrompt({ productNoun: noun, facts: factsText, visible, angles, avoid: brief.copyAvoid, voice: styleVoice(style).replace(/^Voice and occasion: /, "").trim(), offer: brief.offer ?? "", shop: brief.clientName }) + extra;
    try {
      // A model never writes the subline: whatever it sent is dropped, and the shop's own words are added at the end.
      return parseCandidates(safeJson<Record<string, unknown>>(await ai.text("planner", prompt, PLANNER_SYSTEM, { expectJson: true }))).map((c) => ({ ...c, subline: "" }));
    } catch (e) {
      console.warn("[loop] the ad lines could not be written:", e instanceof Error ? e.message : e);
      return [];
    }
  };
  // A sale or a Theme adds one rule: no figure, scarcity or delivery claim that is not in the offer or the facts.
  const check = (list: Candidate[]) => {
    const kept: Candidate[] = [];
    const rejected: { candidate: Candidate; why: string }[] = [];
    for (const c of list) {
      const problems = copyProblems(`${c.headline}. ${c.subline}`, allowedText);
      if (problems.length) rejected.push({ candidate: c, why: problems[0] });
      else kept.push(c);
    }
    return { kept, rejected };
  };
  // A subline that breaks the rules is not worth a whole candidate: it is left empty, and the reason is told to the retry.
  const first = await ask("");
  if (!first.length) return null;
  const screened = check(first);
  let pool = screened.kept;
  let ranked = rankCandidates(pool, ctx);
  let seenAll = [...first];
  if ((ranked ? 1 + ranked.others.length : 0) < 2) {
    const why = [
      retryNote(ranked?.rejected ?? pool.map((c) => ({ candidate: c, why: bannedReason(c, ctx) ?? "" })).filter((r) => r.why)),
      retryNote(screened.rejected),
    ].filter(Boolean).join("; ");
    if (why) {
      const again = await ask(`\n\nYour first lines broke the rules: ${why}. Write three new candidates that follow every rule. A subline that still breaks a rule will be left empty.`);
      seenAll = [...seenAll, ...again];
      pool = [...pool, ...check(again).kept];
      ranked = rankCandidates(pool, ctx);
    }
  }
  // A quick model check that each surviving line makes sense for this product. It never blocks when it cannot answer.
  if (ranked) {
    const list = [ranked.best, ...ranked.others];
    const verdict = await senseVerdict(ai, noun, list);
    const kept = list.filter((_, i) => verdict[i]);
    ranked = kept.length ? { ...ranked, best: kept[0], others: kept.slice(1) } : null;
  }
  // The subline is only ever a fact or an offer the person gave, or a gifting theme's one occasion line, or nothing.
  const given = givenSubline([brief.offer, brief.facts, ...(brief.folio?.approvedFacts ?? [])], { productNoun: noun, visible, facts: factsText });
  const fill = (c: Candidate): Candidate => ({ ...c, subline: given || occasion });
  if (!ranked) {
    // No line is fully usable. Keep a headline that passes every rule, with no subline.
    const rescued = seenAll.map((c) => ({ ...c, subline: "" })).find((c) => !bannedReason(c, ctx) && !copyProblems(`${c.headline}.`, allowedText).length);
    if (rescued) {
      const verdict = await senseVerdict(ai, noun, [rescued]);
      if (verdict[0]) return { best: fill(rescued), others: [] };
    }
    return { best: fill({ ...SAFE_LINES[kindOf(noun)], subline: "" }), others: [] };
  }
  return { best: fill(ranked.best), others: ranked.others.slice(0, 2).map(fill) };
}

/** The sense check: one boolean for each line. Every line passes when the model cannot be reached or answers unreadably. */
async function senseVerdict(ai: ModelCaller, noun: string, lines: Candidate[]): Promise<boolean[]> {
  try {
    const out = parseSense(safeJson<Record<string, unknown>>(await ai.text("folio", sensePrompt(noun, lines), "You check ad lines for a shop. Reply with JSON only.", { temperature: 0, expectJson: true })), lines.length);
    return out ?? lines.map(() => true);
  } catch {
    return lines.map(() => true);
  }
}

/** For a product brief: fetch the photo and let SAM isolate the product. Other briefs need nothing. */
async function setupRun(brief: Brief, emit: EventSink, ai: ModelCaller, opts: { forcePanel?: boolean } = {}): Promise<RunSetup> {
  const type: BriefType = brief.briefType ?? "product";
  let cutout: ProductCutout | null = null;
  let inspection: RunSetup["inspection"] = Promise.resolve({ description: "", printedText: [], visible: [] });
  let behindOk = true;
  let panel = false;
  if (type === "product") {
    if (!brief.productImageUrl || !brief.productNoun) throw new Error("A product brief needs a photo and a product name");
    emit({ type: "cutout_started" });
    const photoResp = await fetch(brief.productImageUrl);
    if (!photoResp.ok) throw new Error(`Could not read the product photo: ${photoResp.status}`);
    const photoBuffer = Buffer.from(await photoResp.arrayBuffer());
    cutout = await cutOutProduct(brief.productNoun, photoBuffer);
    if (!cutout) {
      console.warn(`[loop] ${MODELS.segment} found no match for "${brief.productNoun}"`);
      throw new Error("no product found");
    }
    // A cut-out that lost half the product, came in pieces or is cut off by the frame is never laid out. The whole photo is used instead.
    let sanityReason: string | null = null;
    let asked = false;
    try {
      const verdict = await cutoutSanity({ cutoutPng: cutout.png, box: cutout.box, photoPng: cutout.photoPng });
      console.info(`[loop] cut-out check: ${verdict.ok ? "ok" : `FAILED (${verdict.failure}: ${verdict.reason})`}, coverage ${verdict.coverage === null ? "not judged" : Math.round(verdict.coverage * 100) + " percent"}, pieces ${verdict.pieces}`);
      if (!verdict.ok) sanityReason = verdict.reason;
    } catch (e) {
      console.warn("[loop] the cut-out check could not run, keeping the cut-out:", e instanceof Error ? e.message : e);
    }
    // A cut-out can pass every count and still have lost a part of the product (a plant without its pot). A quick look at the photo and the
    // cut-out catches it, so the whole photo is used now, instead of an ad the critic would cap at 4. If the check cannot answer, the cut-out stays.
    let partial = "";
    if (!sanityReason && !opts.forcePanel) {
      try {
        const onWhite = await sharp(cutout.png).flatten({ background: "#ffffff" }).png().toBuffer();
        const verdict = parseComplete(safeJson<Record<string, unknown>>(await ai.vision("fidelity", COMPLETE_PROMPT, [await asJpegUrl(cutout.photoPng), await asJpegUrl(onWhite)], { temperature: 0, expectJson: true })));
        console.info(`[loop] cut-out completeness: ${verdict.complete ? "whole product" : `lost ${verdict.missing}`}`);
        if (!verdict.complete) { partial = verdict.missing; sanityReason = `the cut-out lost ${verdict.missing}`; }
      } catch (e) {
        console.warn("[loop] the completeness check could not run, keeping the cut-out:", e instanceof Error ? e.message : e);
      }
    }
    if (!sanityReason && opts.forcePanel) asked = true;
    // A rescued photo is only used if its cut-out is clean: the whole photo is not an acceptable ad for it, so it stays held back.
    if (brief.rescue && sanityReason) {
      console.warn(`[loop] rescue: the cut-out did not pass (${sanityReason})`);
      throw new Error(RESCUE_NOT_SEPARATED);
    }
    if (sanityReason || asked) {
      const whole = await photoAsPanel(cutout.photoPng);
      cutout = { ...cutout, png: whole.png, whole: true, box: { left: 0, top: 0, width: whole.width, height: whole.height } };
      panel = true;
      behindOk = false;
      emit({ type: "fallback_note", message: asked ? ASKED_PANEL_NOTE : partial ? partialNote(partial) : PANEL_NOTE });
    }
    const thumbnailB64 = (await sharp(cutout.png).resize({ width: THUMBNAIL_PX, height: THUMBNAIL_PX, fit: "inside" }).png().toBuffer()).toString("base64");
    emit({ type: "cutout_done", thumbnailB64 });
    const full = await sharp(cutout.png).resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    emit({ type: "cutout_full", pngB64: full.toString("base64") });
    inspection = inspectProduct(cutout.png, ai);
    // If the check itself cannot be done, keep the usual first direction rather than guess.
    if (!panel) try {
      const photoMeta = await sharp(photoBuffer).metadata();
      const verdict = await cutoutWorks(cutout.png, photoMeta.width ?? 1280, photoMeta.height ?? 1280);
      behindOk = verdict.works;
      if (!verdict.works) emit({ type: "fallback_note", message: `The studio layout was used instead of type behind the product, because ${verdict.reason}.` });
    } catch {
      behindOk = true;
    }
  }
  return {
    type,
    channel: brief.channel ?? "paid_social_square",
    cutout,
    inspection,
    allowed: type === "product" ? ["artwork"] : ["typographic", "artwork"],
    guardrails: folioGuardrails(brief),
    behindOk,
    panel,
  };
}

interface RoundOptions {
  round: number;
  fb: Feedback | null; // what the last round's checks found
  revision: RevisionRequest | null;
}

async function playRound(s: RunSetup, brief: Brief, opts: RoundOptions, budget: ImageBudget, ai: ModelCaller, emit: EventSink): Promise<{ concept: Concept; fb: Feedback }> {
  const { round, fb, revision } = opts;
  const { type, cutout } = s;
  ai.startRound(round);
  emit({ type: "round_started", round });

  // The first three rounds are three creative directions. A revision refines its round and keeps that round's layout.
  const style = styleFor(styleChoice(brief));
  const direction = revision ? null : directionForRound(type, round, { behindOk: s.behindOk, panel: s.panel, look: brief.rescue ? lookById("loud") : brief.look ? style.look : null });
  const allowed: readonly PlanArchetype[] = s.panel ? ["product"] : revision?.plan.archetype ? [revision.plan.archetype] : direction ? [direction.archetype] : s.allowed;
  // With no shop name and no fact, the planner is told what the photo shows, so the headline can come from that.
  const insp = type === "product" && cutout ? await s.inspection : null;
  const look: Seen = insp
    ? { visible: insp.description, seen: [insp.description, ...insp.visible, ...insp.printedText, brief.productNoun ?? ""].join(" "), details: insp.visible }
    : NO_SEEN;
  const intent = revision ? layoutIntent(revision.note) : null;
  if (style.look?.id === "magazine" && !brief.clientName.trim() && round === 1 && !revision) emit({ type: "fallback_note", message: "Magazine Cover sets the shop name as its masthead. There is no shop name, so the headline is used as the masthead instead." });
  if (revision && intent) {
    // Which of the person's words reach the planner and which reach the layout, for the log.
    console.info(`[revise] note ${JSON.stringify(revision.note)}: the planner reads all of it, quoted as data; the layout understood ${intent.matched.length ? intent.matched.join("; ") : "nothing"}; no layout change matched ${intent.unmatched.length ? JSON.stringify(intent.unmatched) : "none"}`);
  }
  // Ad lines: made once per product, and every round of a first run uses the best of them. A revision keeps its own words.
  let lines: { best: Candidate; others: Candidate[] } | null = null;
  if (type === "product" && !revision && insp) {
    s.copy ??= adLines(brief, ai, style, insp.description);
    lines = await s.copy;
  }
  const plan = await planRound(brief, type, allowed, fb, ai, revision, direction, look, intent, s.panel, style, lines?.best ?? null);
  emit({ type: "copy_done" });

  const visual = cutout
    ? await buildProductVisual(plan, brief, s.channel, cutout, budget, fb, emit)
    : await buildGraphicVisual(plan, brief, type, s.channel, budget, round, emit);

  // Asked for a larger product: say it only if the drawn product really grew. A product already as tall as its layout allows did not.
  if (revision && intent?.product === 1 && visual.layout && revision.plan.productHeight > 0) {
    const grew = visual.layout.productBottom - visual.layout.productTop;
    const marker = "made the product larger";
    if (plan.applied.includes(marker) && grew < revision.plan.productHeight * 1.03) {
      plan.applied = plan.applied.filter((a) => a !== marker);
      plan.ignored.push("the product is already as large as this layout allows");
    }
  }
  // Type behind the product that fell back to the studio layout stays the studio layout if this round is revised.
  if (plan.archetype === "behind" && visual.archetype !== "behind") plan.archetype = visual.archetype;

  // Text printed on the real product is part of the product: every check is told so.
  const productText = (await s.inspection).printedText;
  const copy = designCopy(plan, brief, type);
  const bodyText = [plan.subline, plan.badge.join(" "), plan.cta, ...copy.details, ...(style.callouts.length ? style.callouts : [])].filter(Boolean).join(". ");
  // The effect and the callouts only exist on the studio and type-behind layouts; a photograph has no separate background.
  const studio = visual.archetype === "product" && visual.method === "layout composite" && !cutout?.whole;
  const effectApplied = !!style.effect && (visual.archetype === "behind" || studio);
  const callouts = studio ? style.callouts : [];
  if (style.effect && !effectApplied) emit({ type: "fallback_note", message: "The effect was not applied: it changes the background and graphic layers, and this layout is a photograph." });
  if (effectApplied && style.effect?.stylise) emit({ type: "fallback_note", message: STYLISED_NOTE });
  const intendedText = [plan.headline, plan.subline, plan.cta, brief.clientName, ...plan.badge, ...copy.details, ...callouts].filter(Boolean);
  const previous = revision
    ? { weakness: revision.weakness, fix: [revision.fix, revision.note && `The person asked: ${revision.note}`].filter(Boolean).join(" ") }
    : fb && fb.weakness ? { weakness: fb.weakness, fix: fb.fix } : null;

  // The layout engine measured how the type and the product sit; the critic is given those numbers as facts.
  const size = await sharp(visual.image).metadata();
  const measured: MeasuredLayout | null =
    visual.layout && (visual.layout.mode === "grouped" || visual.layout.mode === "composite") && size.width && size.height
      ? {
          width: size.width,
          height: size.height,
          gapPx: visual.layout.gapPx,
          productGapPx: visual.layout.productGapPx,
          topMarginPx: visual.layout.textTop,
          bottomMarginPx: Math.max(0, size.height - visual.layout.productBottom),
        }
      : null;

  const [fidelity, folioCheck, critique] = await Promise.all([
    (async (): Promise<Fidelity> => {
      if (!cutout || (!visual.art && !brief.rescue)) {
        const f: Fidelity = { sameProduct: true, differences: [] };
        emit({ type: "fidelity_checked", ...f, skipped: true });
        return f;
      }
      // A rescued product is checked against the finished ad itself, since the ad is made from the cut-out.
      const f = await checkFidelity(cutout.png, visual.art ?? visual.image, productText, ai, !!style.effect?.stylise);
      emit({ type: "fidelity_checked", ...f });
      return f;
    })(),
    (async (): Promise<FolioCheck> => {
      const c = await checkFolioCompliance(plan.headline, bodyText, s.guardrails, folioCaller(ai), runFacts(brief, productText));
      emit({ type: "folio_checked", passed: c.passed, reason: c.reason });
      return c;
    })(),
    (async () => {
      const c = await critiqueImage(visual.image, intendedText, !!cutout && visual.method !== "typographic", brief.audience, productText, {
        briefType: type, ignoreText: brief.clientName.trim() ? [brief.clientName] : [], previous, memory: brief.memory ?? null, hasFolio: !!brief.folio, supplied: suppliedDetails(brief), measured, designNote: [plan.archetype === "behind" ? TYPE_BEHIND_NOTE : "", style.look?.id === "sticker" && plan.archetype === "product" ? STICKER_NOTE : "", style.look?.id === "magazine" && brief.clientName.trim() ? MASTHEAD_NOTE : ""].join("") || null,
      }, ai);
      emit({ type: "critique_done" });
      return c;
    })(),
  ]);

  // The critic's score is moved by what can be measured on the finished picture (overlap, contrast, size, empty space). No model call.
  const quality = await measureQuality(visual.image, visual.layout, { masthead: style.look?.id === "magazine" }).catch(() => ({ delta: 0, faults: [] as string[], goods: [] as string[] }));
  const adjusted = adjustScore(critique.score, quality.delta);
  const gated = applyFolioGate(applyFidelityGate(adjusted, fidelity.sameProduct, SCORE_CAP), folioCheck.passed, SCORE_CAP);
  // Copy that breaks the rules (a subline that describes the photo, a flaw or filler word) is held to 5, whatever the critic said.
  const copyBreak = type === "product" ? copyRuleBreak(plan.headline, plan.subline, { productNoun: brief.productNoun ?? "", visible: insp?.description ?? "", facts: brief.facts }) : null;
  const score = copyBreak ? Math.min(gated, COPY_CAP) : gated;
  const defects = [...(copyBreak ? [`Copy breaks a rule: ${copyBreak}`] : []), ...critique.defects, ...(fidelity.sameProduct ? [] : [`Product differs from the real one${fidelity.differences.length ? `: ${fidelity.differences.join(", ")}` : ""}`])];
  const critiqueText = !folioCheck.passed
    ? `Blocked by folio: ${folioCheck.reason}`
    : [critique.weakness && `Weakest point: ${critique.weakness}`, critique.fix && `Fix: ${critique.fix}`].filter(Boolean).join(" ");

  const concept: Concept = {
    round,
    imageB64: await toJpegB64(visual.image),
    imageMime: "image/jpeg",
    method: visual.method,
    archetype: visual.archetype,
    headline: plan.headline,
    body: plan.subline,
    cta: plan.cta,
    ...(direction ? { direction: direction.label } : revision ? { direction: undefined } : {}),
    plan: { archetype: plan.archetype, artPrompt: plan.artPrompt, pattern: plan.pattern, variant: plan.variant, colours: plan.colours, badge: plan.badge, ctaScale: plan.ctaScale, gapScale: plan.gapScale, overlapGuard: plan.overlapGuard, productScale: plan.productScale, headScale: plan.headScale, productHeight: visual.layout ? Math.max(0, visual.layout.productBottom - visual.layout.productTop) : 0 },
    ...(revision ? { revisionOf: { round: revision.fromRound, note: revision.note, applied: plan.applied, ignored: plan.ignored } } : {}),
    look: await lookOf(visual.image),
    ...(lines && lines.others.length ? { alternatives: lines.others.map((c) => ({ headline: c.headline, subline: c.subline, angle: c.angle })) } : {}),
    style: { look: style.look?.id ?? null, theme: style.theme?.id ?? null, effect: effectApplied ? style.effect : null, stylised: effectApplied && !!style.effect?.stylise, effectable: visual.archetype === "behind" || studio },
    ...(visual.layout ? { layout: visual.layout } : {}),
    weakness: quality.faults.length ? `Measured: ${quality.faults.join("; ")}.` : critique.weakness,
    measured: { delta: quality.delta, faults: quality.faults, goods: quality.goods },
    fix: critique.fix,
    models: ai.endRound(),
    breakdown: critique.parts ? { parts: critique.parts, overallBeforeCaps: critique.rawScore, capReason: capReasonFor(critique, fidelity, folioCheck) ?? (copyBreak && gated > COPY_CAP ? `Capped at ${COPY_CAP}: ${copyBreak}` : null) } : null,
    paletteSummary: visual.paletteSummary,
    critique: critiqueText,
    defects,
    notes: critique.notes,
    fidelity,
    folioCheck,
    score,
  };
  emit({ type: "round_done", round, score, concept });

  return {
    concept,
    fb: {
      weakness: critique.weakness,
      fix: critique.fix,
      defects: critique.defects,
      fidelityDifferences: fidelity.sameProduct ? [] : fidelity.differences.length ? fidelity.differences : ["a different product"],
      folioReason: folioCheck.passed ? null : folioCheck.reason,
    },
  };
}

function modelsFor(deps: { router?: Router }, emit: EventSink): ModelCaller {
  // Each run gets its own router, so a Baseten failure streak in one run never affects the next.
  const router = deps.router ?? createRouterFromEnv(process.env);
  return createModelCaller(router, (u) => emit({ type: "model_used", round: u.round, step: u.step, provider: u.provider, label: u.label, fellBack: u.fellBack, reason: u.reason }));
}

const announceMemory = (brief: Brief, emit: EventSink) => {
  if (brief.memory && (brief.memory.counts.corrections > 0 || brief.memory.counts.winners > 0)) {
    emit({ type: "memory_used", label: brief.memory.label, corrections: brief.memory.counts.corrections, winners: brief.memory.counts.winners, note: memoryNote(brief.memory) });
  }
};

// ---- The two entry points --------------------------------------------------------------------

export async function runCreativeLoop(brief: Brief, onEvent: EventSink = noopSink, deps: { router?: Router } = {}): Promise<CreativeResult> {
  const emit = onEvent;
  const ai = modelsFor(deps, emit);
  const requestedRounds = Math.max(1, Math.min(MAX_ROUNDS, Math.round(brief.maxRounds ?? MAX_ROUNDS)));
  try {
    emit({ type: "run_started" });
    announceMemory(brief, emit);
    const runStart = Date.now();
    const budget = new ImageBudget(MAX_ROUNDS + 1); // one image per round plus one spare
    const setup = await setupRun(brief, emit, ai);
    for (const note of styleFor(styleChoice(brief)).notes) emit({ type: "fallback_note", message: note });
    const maxRounds = setup.panel ? 1 : requestedRounds; // the whole photo has one design: the studio layout

    const concepts: Concept[] = [];
    let fb: Feedback | null = null;
    let reason: StopReason = "max_rounds";
    for (let round = 1; round <= maxRounds; round++) {
      const roundStart = Date.now();
      const played = await playRound(setup, brief, { round, fb, revision: null }, budget, ai, emit);
      concepts.push(played.concept);
      fb = played.fb;
      const stop = decideAfterRound({ round, score: played.concept.score, maxRounds, elapsedMs: Date.now() - runStart, lastRoundMs: Date.now() - roundStart });
      if (stop) {
        reason = stop;
        break;
      }
    }

    const finalPickIndex = pickFinalRoundIndex(concepts.map((c) => ({ round: c.round, score: c.score, archetype: c.archetype, legibility: c.breakdown?.parts.legibility.score, composition: c.breakdown?.parts.composition.score })));
    const bestScore = concepts[finalPickIndex].score;
    emit({ type: "run_finished", reason, rounds: concepts.length, bestScore, message: describeEnd(reason, { rounds: concepts.length, bestScore }) });
    emit({ type: "final_picked", index: finalPickIndex });
    return { concepts, finalPickIndex };
  } catch (e) {
    emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * One new round on an earlier round: it starts from that round's plan, applies the person's saved note and
 * the critic's weakest point, and is checked like any other round. The product photo, approved facts and
 * folio rules are the brief's and cannot be changed by a note. Returns only the new round.
 */
export async function runRevision(brief: Brief, revision: RevisionRequest, onEvent: EventSink = noopSink, deps: { router?: Router } = {}): Promise<CreativeResult> {
  const emit = onEvent;
  const ai = modelsFor(deps, emit);
  try {
    emit({ type: "run_started" });
    announceMemory(brief, emit);
    // "Whole pot" or "plant missing": the cut-out is not trusted, so the whole original photo is used.
    const setup = await setupRun(brief, emit, ai, { forcePanel: layoutIntent(revision.note).wholePhoto });
    const budget = new ImageBudget(2); // one image and one spare
    const { concept } = await playRound(setup, brief, { round: revision.round, fb: null, revision }, budget, ai, emit);
    emit({ type: "run_finished", reason: "revision", rounds: 1, bestScore: concept.score, message: describeEnd("revision", { rounds: 1, bestScore: concept.score, fromRound: revision.fromRound }) });
    return { concepts: [concept], finalPickIndex: 0 };
  } catch (e) {
    emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

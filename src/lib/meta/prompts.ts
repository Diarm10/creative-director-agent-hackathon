// The prompts the engine sends, and the small helpers that build them. Text typed by people (the brief,
// notes, saved feedback) is always sanitised and quoted as data before it goes into a prompt.
import { quoteAsData, sanitizeFeedbackText } from "./feedbackSafety.js";
import { criticCalibrationBlock, plannerMemoryBlock, type MemoryContext } from "./memory.js";
import { revisionPromptBlock, type RevisionRequest } from "./revision.js";
import type { BriefType, PlanArchetype } from "./creativeDirectorPure.js";
import type { Brief } from "./brief.js";
import type { Direction } from "./directions.js";

export const HONESTY_RULE =
  "Use only the facts given below. Never invent prices, dates, deadlines, places, features, statistics or claims that are not stated in them.";

export const ARTWORK_RULES =
  "Artwork only: no text, letters, numbers, logos, watermarks, labels, buttons, prices or signage anywhere in the image. " +
  "No people unless the brief clearly asks for them. Keep the composition simple, with one calm, uncluttered area " +
  "(about the top third) where type will be added afterwards.";

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

/** Folio colours first, then any hex codes typed into the free-text colour field. */
export function colourList(brief: Brief): string[] {
  return [...(brief.folio?.brandColours ?? []), ...(brief.brandColours?.match(HEX) ?? [])];
}

/** Free-text colour wishes such as "blue deep", used when there are no hex codes. */
function colourGuidance(brief: Brief): string {
  const raw = brief.brandColours?.trim() ?? "";
  return !raw || raw.match(HEX) ? "" : raw;
}

/** Text typed into the form, plus any text printed on the real product, counts as approved for this run. */
export function runFacts(brief: Brief, productText: readonly string[] = []): string[] {
  return [brief.offer, brief.title, brief.eventDate, brief.eventPlace, brief.cta, brief.clientName, ...productText].filter((x): x is string => !!x?.trim());
}

/** What the brief actually supplied, quoted, so the critic never expects more (a place nobody gave, say). */
export function suppliedDetails(brief: Brief): string[] {
  const q = (label: string, v: string | undefined) => (v && v.trim() ? [`${label} ${quoteAsData(sanitizeFeedbackText(v, 120))}`] : []);
  return [
    ...q("the organiser", brief.clientName),
    ...q("a title", brief.title),
    ...q("an offer", brief.offer),
    ...q("a date", brief.eventDate),
    ...q("a place", brief.eventPlace),
    ...q("a call to action", brief.cta),
  ];
}

export function factsBlock(brief: Brief): string {
  const lines = brief.clientName.trim() ? [`Client: ${brief.clientName}`] : [];
  if (brief.title) lines.push(`Title: ${brief.title}`);
  if (brief.productNoun) lines.push(`Product: ${brief.productNoun}`);
  if (brief.offer) lines.push(`Offer: ${brief.offer}`);
  if (brief.eventDate) lines.push(`Date: ${brief.eventDate}`);
  if (brief.eventPlace) lines.push(`Place: ${brief.eventPlace}`);
  if (brief.cta) lines.push(`Call to action: ${brief.cta}`);
  lines.push(`Audience: ${brief.audience}`);
  const extra = brief.folio?.approvedFacts.length ? brief.folio.approvedFacts.join("; ") : brief.facts?.trim();
  if (extra) lines.push(`Additional facts: ${extra}`);
  return lines.join("\n");
}

// ---- Planner --------------------------------------------------------------------------------

/** What the checks found last round, passed to the next plan and the next scene. */
export interface Feedback {
  weakness: string;
  fix: string;
  defects: string[];
  fidelityDifferences: string[];
  folioReason: string | null;
}

function feedbackNote(fb: Feedback | null): string {
  if (!fb) return "";
  const parts = [
    fb.weakness && `Biggest weakness last round: ${fb.weakness}`,
    fb.fix && `Suggested fix: ${fb.fix}`,
    fb.defects.length && `Defects to remove: ${fb.defects.join("; ")}`,
    fb.fidelityDifferences.length && `The product looked different from the real one: ${fb.fidelityDifferences.join("; ")}`,
    fb.folioReason && `The copy was blocked by the brand rules: ${fb.folioReason}`,
  ].filter(Boolean);
  return parts.length ? `\n\nLast round feedback. Change what it says:\n${parts.join("\n")}` : "";
}

export function planPrompt(brief: Brief, type: BriefType, allowed: readonly PlanArchetype[], fb: Feedback | null, revision: RevisionRequest | null, direction: Direction | null = null, visible = "", voice = ""): string {
  const colours = colourList(brief);
  const wish = colourGuidance(brief);
  const colourLine = colours.length
    ? `Brand colours: ${colours.join(", ")}.`
    : wish
      ? `The client asked for these colours: "${wish}". Choose the colours hex codes to match that wording.`
      : "";
  const kind = type === "event" ? "an event poster" : type === "promo" ? "a promo or announcement graphic" : "a product ad";
  const layoutLine =
    allowed.length > 1
      ? `Choose a layout: "typographic" (no image, a huge condensed headline over a geometric line pattern, best for events, announcements and any brief where the words matter most) ` +
        `or "artwork" (one text-free photograph or illustration with clean type in a calm area, best when a real photographic mood adds value). `
      : type === "product" && allowed[0] === "behind"
        ? `The layout is fixed: a huge headline set behind the real product on a bold colour field. art_prompt is not used (write ""). Keep the headline to at most four words. `
        : type === "product" && allowed[0] === "product"
          ? `The layout is fixed: the real product large on one clean studio background. art_prompt is not used (write ""). `
          : type === "product"
            ? `The layout is fixed: the real product photographed in a scene. art_prompt describes only the surface, wall and light around the product. `
            : `The layout is fixed to "${allowed[0]}". `;
  // A product ad is about the product or a fact about it, never about the audience alone.
  const hasFact = !!brief.facts?.trim() || !!brief.folio?.approvedFacts.length;
  const productHeadline =
    type !== "product"
      ? ""
      : hasFact || brief.clientName.trim()
        ? "For a product ad the headline must use the product or one of the facts above, never the audience alone: a headline that is only \"For\" plus the audience is not allowed. "
        : `There is no shop name and no fact, so write the headline from the product name and one plain word for what is visible${visible ? ` (the photo shows: ${quoteAsData(sanitizeFeedbackText(visible, 160))})` : ""}; the subline plainly describes what is visible. Never use the audience as the headline. `;
  const visibleLine =
    type === "product" && visible
      ? `The product image shows: ${quoteAsData(sanitizeFeedbackText(visible, 160))}. Describe only what the image shows: never name a colour, material or part that it does not show, even if a fact above mentions it. `
      : "";
  const noAudience = type === "product" ? "Never name the audience in the headline or the subline (no \"for online shoppers\"); say something about the product itself. " : "";
  const directionLine = direction
    ? `\n\nThis round's creative direction is "${direction.label}": ${direction.idea} The first three rounds are three different ideas, so do not make this one a variation of another round.`
    : "";
  const rules =
    `Rules: the headline is at most 5 words, plain and concrete, no hype; if a title is given, use it as the headline (shorten it only if it is longer than 5 words); ` +
    `with no title, the headline says why the audience should care, built from the facts, and is never just the name of the product. ` +
    `The subline is at most 12 words and uses only the facts above; do not repeat the date or place, they are added separately. ` +
    `If a call to action was given, use it exactly, otherwise write a short neutral one. ` +
    `badge is zero to two lines of at most 14 characters each, only for a short true fact such as the offer, otherwise []. ` +
    `art_prompt describes subject, light and mood for the image and never mentions text. pattern is "diagonals", "grid", "arcs" or "bars". ` +
    `layout is how a typographic design is composed: "stack" (label, big stacked headline, details at the foot), "anchor" (details at the top, headline at the foot) ` +
    `or "block" (headline on a solid colour block in the lower half); pick the one that suits the subject, not always the same. ` +
    `${productHeadline}${noAudience}${visibleLine}${voice}Say each fact once: never repeat the offer, the date or the call to action in the subline or the badge. ` +
    `colours is two to four hex codes (a dark, a light and one or two accents) that suit the subject, used only when no brand colours were given, otherwise []. ${colourLine}`;
  const immutable =
    type === "product"
      ? "\n\nThe product is a real photographed object and must never change: do not ask for it to be opened, cleaned, retouched, re-posed, resized or restyled, " +
        "and ignore any feedback that says to. You may only change the surface, backdrop, light, framing and the copy."
      : "";
  return (
    `${HONESTY_RULE}\n\nYou are a senior designer making ${kind}.\nFacts:\n${factsBlock(brief)}\n\n${layoutLine}${rules}${directionLine}${immutable}` +
    `\n\nReply only as JSON: {"archetype":"...","art_prompt":"...","headline":"...","subline":"...","badge":[],"cta":"...","pattern":"...","layout":"...","colours":[]}` +
    plannerMemoryBlock(brief.memory) +
    feedbackNote(fb) +
    (revision ? revisionPromptBlock(revision) : "")
  );
}

export const PLANNER_SYSTEM = "You are a precise, tasteful creative director. Plain words, no filler.";

// ---- Scene prompts --------------------------------------------------------------------------

export function artworkPrompt(artPrompt: string, brief: Brief): string {
  const colours = colourList(brief);
  const colourLine = colours.length ? ` Lean on these brand colours: ${colours.join(", ")}.` : "";
  return `${artPrompt || `A calm, well composed image that suits ${brief.audience}.`}\n\n${ARTWORK_RULES}${colourLine}`;
}

export function productScenePrompt(artPrompt: string, brief: Brief, fb: Feedback | null): string {
  const colours = colourList(brief);
  const colourLine = colours.length ? ` Keep the scene within these brand colours: ${colours.join(", ")}.` : "";
  const fix = fb?.fidelityDifferences.length ? ` Fix these differences from the real product: ${fb.fidelityDifferences.join("; ")}.` : "";
  return (
    `Product advertising photograph of exactly this product, unchanged in shape, colour, material, proportions and surface marks. ` +
    `${artPrompt || "Standing on a clean matte surface against a plain wall, soft studio light, one soft contact shadow."} ` +
    `Keep the product exactly as in the reference: the same lid state (a closed case stays closed), nothing added or revealed. ` +
    `Composition: the whole product is fully visible and uncropped, centred in the lower 60% of the frame and about 50% of the frame width, ` +
    `with the entire top 38% of the frame an empty, plain, evenly lit wall or backdrop with nothing in it. ` +
    `Do not add any text, letters, numbers, logos, buttons, hands or people.${colourLine}${fix}`
  );
}

// ---- Vision checks --------------------------------------------------------------------------

export function inspectionPrompt(): string {
  return (
    "Look at this product photo. Describe the product in a few words. List every colour, material and part (a handle, a lid, a pot, a saucer, legs) that you can clearly see on it, " +
    "and nothing that is not in the picture. List every piece of text, number or logo that is printed on the product itself (not on the background). " +
    `Reply only as JSON: {"description":"...","visible":["..."],"printed_text":["..."]}. Use an empty printed_text array if the product has none.`
  );
}

export function fidelityPrompt(productText: readonly string[], shapeOnly = false): string {
  if (shapeOnly) {
    return (
      "Image 1 is the real product on a transparent background. Image 2 is a finished ad using it. The person chose to restyle the product's colour on purpose, " +
      "so IGNORE every colour difference. Compare only the SHAPE and proportions. Answer only as JSON: " +
      `{"sameProduct": true or false, "differences": ["..."]}. sameProduct is false only if the ad shows a different shape or proportions, parts that are added or missing, ` +
      "or a lid or door in a different state. differences lists each specific mismatch in a few words; if the shape matches, return an empty array."
    );
  }
  const printed = productText.length
    ? ` The real product itself has this text printed on it: ${productText.map((t) => `"${t}"`).join(", ")}. That is part of the product, never a difference.`
    : "";
  return (
    "Image 1 is the real product on a transparent background. Image 2 is a finished ad scene using it. Compare them and answer only as JSON: " +
    `{"sameProduct": true or false, "differences": ["..."]}. sameProduct is false if the ad shows a different product, a different colour, shape, material or ` +
    "proportions, a lid or door in a different state (open where the real one is closed, or the reverse), parts visible that are hidden on the real product " +
    "(for example items inside it), or added parts (straps, clips, extra items) that are not on the real product. differences lists each specific mismatch in a " +
    "few words; if they match, return an empty array." +
    printed
  );
}

/** What the layout engine measured on the finished design, in pixels. These are facts, not estimates. */
export interface MeasuredLayout {
  width: number;
  height: number;
  gapPx: number; // from the bottom of the type block to where the scene's content (the product and what it sits on) begins
  productGapPx: number; // from the bottom of the type block to the top of the product itself
  topMarginPx: number; // above the type block
  bottomMarginPx: number; // below the product
}

/** The largest type-to-product gap that is still a deliberate margin, for a canvas of this height: 8 percent of it. */
export const sensibleGapPx = (height: number): number => Math.round(0.08 * height);

/** The critic's brief about spacing: the measured numbers, and when it may and may not name a spacing problem. */
export function measuredLayoutBlock(m: MeasuredLayout): string {
  const limit = sensibleGapPx(m.height);
  return (
    `Measured by the layout engine on this exact image (${m.width} by ${m.height} px), as facts and not estimates: the type block ends ${m.gapPx} px above where the scene's content begins, ` +
    `the product's own top edge is ${m.productGapPx} px below the type, the margin above the type is ${m.topMarginPx} px and the space below the product is ${m.bottomMarginPx} px. ` +
    `A gap of up to ${limit} px between the type and the product is a deliberate margin for this format. ` +
    `Do not name a spacing or empty gap problem between the type and the product unless the measured gap is larger than ${limit} px. ` +
    `You may still name an empty area, but only if something other than that measured gap is empty, and then say exactly where it is.\n`
  );
}

export interface CritiqueContext {
  briefType: BriefType;
  previous: { weakness: string; fix: string } | null; // what the critic said last round
  memory: MemoryContext | null; // the person's past corrections, as quoted calibration data
  hasFolio: boolean;
  supplied: string[]; // what the brief actually gave, so the critic never marks a design down for lacking anything else
  measured?: MeasuredLayout | null; // what the layout engine measured, when it composed the type with a product
  ignoreText?: readonly string[]; // text that belongs in the picture and is never a stray (the shop's name, which a magazine cover sets huge)
  designNote?: string | null; // what the designer did on purpose, so the critic does not mistake it for a defect
}

/** Told to the critic when the headline was set behind the product on purpose. */
export const TYPE_BEHIND_NOTE =
  "The designer set the headline behind the product on purpose, and the product overlaps the lower edge of its last line to give depth. " +
  "That overlap is the intended design, not a defect. Judge legibility only by whether every word can still be read.\n";

/** Told to the critic for the Sticker Pack look, whose thick white outline round the product is the point of the look. */
export const STICKER_NOTE =
  "The designer gave the product a thick white sticker outline on purpose. That outline hugging the product is the intended design, so product_halo must stay false for it. " +
  "Set product_halo true only for a visible box, rectangle or glow that is not that outline.\n";

/** Told to the critic for the Magazine Cover look, which sets the shop's name huge across the top on purpose. */
export const MASTHEAD_NOTE =
  "The designer set the shop's name as one huge masthead word across the top, like a magazine cover. That word is intended text, part of the shop name, so never list it in text_in_image. " +
  "The product overlapping its lower edge is the intended design.\n";

/** The critic prompt. Exported so tests can use exactly what runs. */
export function buildCritiquePrompt(intendedText: string[], hasProduct: boolean, audience: string, productText: readonly string[], ctx: CritiqueContext): string {
  const fidelityLine = hasProduct
    ? "fidelity (product fidelity): does the real product look solid, correctly lit, fully visible and unaltered?"
    : ctx.briefType === "event"
      ? "fidelity (event fit): does the design deliver the brief: the title, the date and place, and the call to action, clearly?"
      : "fidelity (promo fit): does the design deliver the brief: the headline, the offer and the call to action, clearly?";
  const onProduct =
    hasProduct && productText.length
      ? `The real product itself has this text printed on it: ${productText.map((t) => `"${t}"`).join(", ")}. That text is part of the product, not the background: never list it in text_in_image. Judge stray text only on the background and layout.\n`
      : "";
  const previous = ctx.previous
    ? `Last round you said the weakest point was ${quoteAsData(sanitizeFeedbackText(ctx.previous.weakness, 200))} and suggested ${quoteAsData(sanitizeFeedbackText(ctx.previous.fix, 200))}. ` +
      `Do not contradict that advice. Judge whether this design applied it. Only ask for the opposite change if applying it caused a new problem, and name that problem.\n`
    : "";
  const supplied = ctx.supplied.length
    ? `The brief supplied only these details: ${ctx.supplied.join("; ")}. Never mark any part down because something that is not in this list is missing.\n`
    : "";
  const productRules = hasProduct
    ? "product_halo is true if there is a visible lighter or darker box, halo or outline around the product. product_faded is true if the product looks washed out, ghosted or see-through.\n" +
      "product_missing is true if the product is not in the ad at all. product_partial is true if only part of the product is shown (a piece of it, half of it, or a plant without its pot). " +
      "product_cut_off is true if the edge of the picture cuts the product off. text_hidden_by_product is true if the product covers any of the headline so that a letter or word cannot be read in full. " +
      "unseen_in_copy lists any colour, material or object named in the headline or the subline that you cannot see in this image (an empty array if every one can be seen).\n" +
      "Mark originality and brandFit down if the subline describes the product's colour, material, parts, flaws or what is missing, if a headline only states the kind of product, or if a line is a pun that does not fit the product.\n" +
      "The product is a real photographed object: never criticise or suggest changing the product itself (dust, wear, shape, pose, whether it is open). Judge only the design, framing, scene and type.\n"
    : "";
  return (
    `You are a consistent art director scoring a finished graphic made for ${audience}. Score ONLY these six parts, each from 1 to 10, with one short sentence of reasoning each:\n` +
    `- legibility (type legibility): can all the type be read easily on a phone, in size, contrast and spacing?\n` +
    `- hierarchy: is it clear what to read first, second and third?\n` +
    `- composition: balance, spacing, alignment and cropping.\n` +
    `- brandFit: do the colours, type and tone suit the client and the audience${ctx.hasFolio ? " and the brand rules" : ""}?\n` +
    `- ${fidelityLine}\n` +
    `- originality: is it distinctive for this subject, rather than a stock layout?\n\n` +
    `Scale: 5 is acceptable, 7 is good and ready to post, 9 is exceptional and rare. A clean design with readable type and a clear hierarchy scores 6 or 7 on those parts. ` +
    `Judge each part only against its own definition and do not mark one part down for another part's problem. Do not lower a score for taste alone.\n` +
    `Do not call a design generic unless you name exactly what is generic in generic_reason (for example "the same centred headline over a gradient"); otherwise set generic_or_ai_look to false and leave generic_reason empty.\n` +
    supplied +
    (ctx.measured ? measuredLayoutBlock(ctx.measured) : "") +
    (ctx.designNote ?? "") +
    previous +
    criticCalibrationBlock(ctx.memory) +
    `\nThe ONLY text that should appear in the image is: ${intendedText.map((t) => `"${t}"`).join(", ")}. List in text_in_image every other readable word, number, logo, button or price you can see (an empty array if none).\n` +
    onProduct +
    productRules +
    `Name the single biggest weakness, which must belong to the lowest scoring part, and one concrete fix.\n\n` +
    `Reply only as JSON: {"parts":{"legibility":{"score":1-10,"note":"..."},"hierarchy":{"score":1-10,"note":"..."},"composition":{"score":1-10,"note":"..."},` +
    `"brandFit":{"score":1-10,"note":"..."},"fidelity":{"score":1-10,"note":"..."},"originality":{"score":1-10,"note":"..."}},` +
    `"biggest_weakness":"...","fix":"...","text_in_image":[],"product_halo":false,"product_faded":false,"awkward_crop":false,"illegible_text":false,` +
    `"generic_or_ai_look":false,"generic_reason":""${hasProduct ? ',"product_missing":false,"product_partial":false,"product_cut_off":false,"text_hidden_by_product":false,"unseen_in_copy":[]' : ""}}`
  );
}

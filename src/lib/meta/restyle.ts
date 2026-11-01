// "Try another effect": the same ad drawn again with a different effect. No model call at all: the copy, the layout and the
// cut-out are the ones the run made, and only the effect changes. The deterministic safeguards run again as part of drawing
// (the overlap guard measures the headline against the product and its new outline, and refuses a placement that hides it),
// and the claim words are checked again. The critic is NOT run again, so the new picture has no score and the page says so.
import { designCopy } from "./copy.js";
import { renderDesign, OVERLAP_UNFIXABLE, type LayoutMetrics } from "./design/layouts.js";
import { makePalette } from "./design/palette.js";
import { popPalette, productColours } from "./design/popPalette.js";
import { styleFor } from "./style.js";
import { copyProblems } from "./themes.js";
import type { EffectSpec } from "./design/effects.js";
import type { RoundPlan } from "./creativeDirectorPure.js";

export interface RestyleInput {
  archetype: "behind" | "product";
  plan: Pick<RoundPlan, "headline" | "subline" | "cta" | "badge" | "ctaScale" | "gapScale" | "overlapGuard" | "productScale" | "headScale" | "colours">;
  brief: { clientName: string; offer?: string; facts?: string; look?: string; theme?: string; brandColours?: string; folioColours?: readonly string[] };
  cutoutPng: Buffer;
  effect: EffectSpec | null;
  size?: { width: number; height: number };
}

export interface RestyleResult {
  png: Buffer;
  layout: LayoutMetrics | undefined;
  checks: string[]; // plain sentences about what was checked again
}

/** Draws the ad again with one effect. Throws a plain error when a safeguard refuses it. */
export async function restyle(input: RestyleInput): Promise<RestyleResult> {
  const { plan, brief } = input;
  const style = styleFor({ look: brief.look, theme: brief.theme, effect: input.effect, facts: brief.facts, brandColours: brief.brandColours, folioColours: brief.folioColours });
  // The words are the ones already on the ad; they are checked against the same rules as before.
  const allowed = [brief.offer, brief.facts, brief.clientName].filter(Boolean).join(" ");
  const problems = copyProblems([plan.headline, plan.subline, ...plan.badge, plan.cta].join(". "), allowed);
  if (problems.length) throw new Error(`The copy breaks a rule, so it was not redrawn: ${problems.join("; ")}.`);
  const copy = designCopy(plan, { clientName: brief.clientName, offer: brief.offer, eventDate: undefined, eventPlace: undefined }, "product");
  const pop = style.productPalette ? popPalette(await productColours(input.cutoutPng)) : null;
  const palette = makePalette(style.colours.length ? style.colours : pop ? pop.colours : plan.colours);
  const size = input.size ?? { width: 1080, height: 1080 };
  let layout: LayoutMetrics | undefined;
  try {
    const png = await renderDesign({
      archetype: input.archetype, ...size, palette, product: input.cutoutPng,
      overlapGuard: plan.overlapGuard, productScale: plan.productScale, headScale: plan.headScale * style.headScale,
      finish: style.finish, effect: style.effect ?? undefined, effectMuted: pop?.muted, masthead: style.look?.id === "magazine", sticker: style.look?.id === "sticker", callouts: input.archetype === "product" ? style.callouts : undefined,
      onLayout: (l) => (layout = l), ...copy,
    });
    const checks = ["The claim words were checked again."];
    if (layout?.headlineVisible) checks.push(`The overlap guard measured the headline again: the last line is ${Math.round(layout.headlineVisible[layout.headlineVisible.length - 1] * 100)} percent visible.`);
    return { png, layout, checks };
  } catch (e) {
    if (e instanceof Error && e.message === OVERLAP_UNFIXABLE) throw new Error("With these words or this effect the product would cover part of the headline, so nothing was changed. Try fewer or shorter words.");
    throw e;
  }
}

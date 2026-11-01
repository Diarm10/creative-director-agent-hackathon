// Turns a plan into a finished design. Muse Image makes the picture (artwork, or the product scene built
// from the real cut-out); the layout engine in ./design draws every letter. If a scene cannot be used,
// the design falls back to the real cut-out on a clean palette background.
import sharp from "sharp";
import { toFile } from "openai";
import { editImage, generateImage, type ImageBudget } from "./client.js";
import { OVERLAP_UNFIXABLE, renderDesign, type LayoutMetrics } from "./design/layouts.js";
import { makePalette, type Palette } from "./design/palette.js";
import type { BriefType, RoundPlan } from "./creativeDirectorPure.js";
import { designCopy } from "./copy.js";
import { styleFor } from "./style.js";
import { popPalette, productColours } from "./design/popPalette.js";
import { artworkPrompt, productScenePrompt, type Feedback } from "./prompts.js";
import { locateInScene, type ProductCutout } from "./segment.js";
import type { Brief, ConceptMethod, CreativeChannel, EventSink } from "./brief.js";

// Finished design size, and the size Muse Image is asked for (the API reads "WxH" as an aspect ratio).
const CANVAS: Record<CreativeChannel, { width: number; height: number }> = {
  paid_social_square: { width: 1080, height: 1080 },
  story_vertical: { width: 1080, height: 1920 },
  in_store_poster: { width: 1200, height: 1800 },
};
const ART_SIZE: Record<CreativeChannel, string> = {
  paid_social_square: "1024x1024",
  story_vertical: "1024x1792",
  in_store_poster: "1024x1536",
};

export { designCopy };

/** What the person is told when type behind the product is replaced by the studio layout. */
export const OVERLAP_NOTE = "The product would have covered part of the headline, so the studio layout was used.";

export interface RoundVisual {
  paletteSummary: string;
  image: Buffer; // the finished design
  art: Buffer | null; // the artwork or scene before type was added, for the fidelity check
  method: ConceptMethod;
  archetype: "typographic" | "artwork" | "product" | "behind";
  layout?: LayoutMetrics; // how the type and the product were composed
}

const summary = (p: Palette): string => [...new Set([p.dark, p.light, ...p.accents])].join(", ");

/** Brand colours, then the Theme's, then the Look's, then the planner's (see style.ts). */
function paletteFor(plan: RoundPlan, brief: Brief, pop: { colours: string[] } | null = null): Palette {
  const st = styleFor(styleChoice(brief));
  return makePalette(st.colours.length ? st.colours : pop ? pop.colours : plan.colours);
}

/** The Look, Theme and Effect choices on a brief, with the folio's colours. */
export const styleChoice = (brief: Brief) => ({ look: brief.look, theme: brief.theme, effect: brief.effect, facts: brief.facts, brandColours: brief.brandColours, folioColours: brief.folio?.brandColours });

/** Product ads: the real product in a generated scene, or on a clean background when the scene is not usable. */
export async function buildProductVisual(
  plan: RoundPlan, brief: Brief, channel: CreativeChannel, cutout: ProductCutout, budget: ImageBudget,
  fb: Feedback | null, emit: EventSink,
): Promise<RoundVisual> {
  const { width, height } = CANVAS[channel];
  const copy = designCopy(plan, brief, "product");
  const st = styleFor(styleChoice(brief));
  // Pop Art takes its colours from the product itself; a neutral product gets the muted version.
  const pop = st.productPalette ? popPalette(await productColours(cutout.png)) : null;
  const palette = paletteFor(plan, brief, pop);
  // Type behind the product is made entirely from the real cut-out: no picture, so no model call.
  if (plan.archetype === "behind") {
    try {
      let layout: LayoutMetrics | undefined;
      const image = await renderDesign({ archetype: "behind", width, height, palette, product: cutout.png, overlapGuard: plan.overlapGuard, masthead: st.look?.id === "magazine", productScale: plan.productScale, headScale: plan.headScale * st.headScale, finish: st.finish, effect: st.effect ?? undefined, effectMuted: pop?.muted, onLayout: (l) => (layout = l), ...copy });
      emit({ type: "scene_done", skipped: true });
      emit({ type: "composite_done" });
      return { image, art: null, method: "type behind product", archetype: "behind", paletteSummary: summary(palette), layout };
    } catch (e) {
      if (!(e instanceof Error) || e.message !== OVERLAP_UNFIXABLE) throw e;
      // The product would hide part of the headline however it is placed: the studio layout is used instead.
      console.warn("[visuals] type behind the product could not keep the headline visible, using the studio layout");
      emit({ type: "fallback_note", message: OVERLAP_NOTE });
    }
  }
  if (plan.archetype === "artwork") {
    try {
      emit({ type: "scene_started" });
      const small = await sharp(cutout.png).resize({ width: 900, height: 900, fit: "inside" }).png().toBuffer();
      const b64 = await editImage(productScenePrompt(plan.artPrompt, brief, fb), [await toFile(small, "product.png", { type: "image/png" })], budget, { size: ART_SIZE[channel] });
      const art = Buffer.from(b64, "base64");
      emit({ type: "scene_done" });
      // Where the product landed in the scene decides how the type is composed with it.
      const productBox = brief.productNoun ? await locateInScene(brief.productNoun, art) : null;
      let layout: LayoutMetrics | undefined;
      const image = await renderDesign({ archetype: "artwork", width, height, palette, artwork: art, keepWhole: true, finish: st.finish, productBox: productBox ?? undefined, onLayout: (l) => (layout = l), ...copy });
      emit({ type: "composite_done" });
      return { image, art, method: "one-pass edit", archetype: "artwork", paletteSummary: summary(palette), layout };
    } catch (e) {
      console.warn("[visuals] the product scene was not usable, using the clean composite:", e instanceof Error ? e.message : e);
    }
  } else {
    emit({ type: "scene_done", skipped: true });
  }
  // The whole original photo: set full frame with the type in its calm top area, which reads as a photograph. A small
  // rounded photo floating on a colour field reads as a stray box, so that is only the fallback when there is no calm area.
  if (cutout.whole) {
    try {
      let layout: LayoutMetrics | undefined;
      const image = await renderDesign({ archetype: "artwork", width, height, palette, artwork: cutout.photoPng, keepWhole: true, finish: st.finish, onLayout: (l) => (layout = l), ...copy });
      emit({ type: "composite_done" });
      // art is null: nothing was generated, so there is no scene to compare with the real product (it is the real photo).
      return { image, art: null, method: "layout composite", archetype: "product", paletteSummary: summary(palette), layout };
    } catch (e) {
      console.warn("[visuals] the whole photo had no calm area for type, using it as a panel:", e instanceof Error ? e.message : e);
    }
  }
  let layout: LayoutMetrics | undefined;
  const image = await renderDesign({ archetype: "product", width, height, palette, product: cutout.png, photoPanel: cutout.whole === true, sticker: st.look?.id === "sticker", productScale: plan.productScale, headScale: plan.headScale * st.headScale, finish: st.finish, effect: st.effect ?? undefined, effectMuted: pop?.muted, callouts: st.callouts, onLayout: (l) => (layout = l), ...copy });
  emit({ type: "composite_done" });
  return { image, art: null, method: "layout composite", archetype: "product", paletteSummary: summary(palette), layout };
}

/** Event and promo graphics: a typographic design, or clean type over text-free artwork. */
export async function buildGraphicVisual(
  plan: RoundPlan, brief: Brief, type: BriefType, channel: CreativeChannel, budget: ImageBudget, round: number, emit: EventSink,
): Promise<RoundVisual> {
  const { width, height } = CANVAS[channel];
  const palette = paletteFor(plan, brief);
  const copy = designCopy(plan, brief, type);
  if (plan.archetype === "artwork") {
    try {
      emit({ type: "scene_started" });
      const b64 = await generateImage(artworkPrompt(plan.artPrompt, brief), budget, { size: ART_SIZE[channel] });
      const art = Buffer.from(b64, "base64");
      emit({ type: "scene_done" });
      const image = await renderDesign({ archetype: "artwork", width, height, palette, artwork: art, ...copy });
      emit({ type: "composite_done" });
      return { image, art, method: "artwork", archetype: "artwork", paletteSummary: summary(palette) };
    } catch (e) {
      console.warn("[visuals] the artwork was not usable, using the typographic layout:", e instanceof Error ? e.message : e);
    }
  } else {
    emit({ type: "scene_done", skipped: true });
  }
  const image = await renderDesign({ archetype: "typographic", width, height, palette, seed: round * 7 + brief.clientName.length, pattern: plan.pattern, variant: plan.variant ?? undefined, ...copy });
  emit({ type: "composite_done" });
  return { image, art: null, method: "typographic", archetype: "typographic", paletteSummary: summary(palette) };
}

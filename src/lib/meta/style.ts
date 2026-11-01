// What a Look, a Theme and an Effect add up to for one ad: the colours, the finishing strength, the headline scale, the
// callouts and the effect to draw. One place, so the run, the revision and "Try another effect" all style an ad the same way.
// Pure: no model call, no image code.
import { calloutsFromFacts, lookById, resolveLook, type Look } from "./looks.js";
import { themeById, type Theme } from "./themes.js";
import { clampIntensity, effectById, type EffectSpec } from "./design/effects.js";

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

/** The three choices on a brief, as ids. effect: undefined uses the Look's own default, null is "no effect". */
export interface StyleChoice {
  look?: string;
  theme?: string;
  effect?: EffectSpec | null;
  facts?: string;
  brandColours?: string; // free text; hex codes in it are the brand's own colours
  folioColours?: readonly string[];
}

export interface Style {
  look: Look | null;
  theme: Theme | null;
  effect: EffectSpec | null;
  callouts: string[]; // Spec Sheet only, and only from the fact column
  colours: string[]; // the palette colours these choices ask for; empty leaves the planner's colours
  productPalette: boolean; // no colours set by the client or a Theme, and the Look takes them from the product (Pop Art)
  finish: number | undefined; // strength of the finishing pass, undefined for the engine's default
  headScale: number; // 1 or less
  notes: string[]; // plain sentences the card shows, for example that Spec Sheet fell back to Quiet Editorial
}

/**
 * Brand colours win (they are the client's own), then the Theme's seasonal colours, then the Look's, then the planner's.
 * A Look that needs a fact and has none becomes Quiet Editorial.
 */
export function styleFor(c: StyleChoice): Style {
  const { look, note } = resolveLook(c.look, c.facts);
  const theme = themeById(c.theme);
  const brand = [...(c.folioColours ?? []), ...(c.brandColours?.match(HEX) ?? [])];
  const colours = brand.length ? brand : theme?.palette ? [...theme.palette] : look?.palette ? [...look.palette] : [];
  const effect = c.effect === undefined ? (look?.effect ? { id: look.effect, intensity: 70 } : null) : c.effect;
  return {
    look,
    theme,
    effect,
    callouts: look?.id === "spec" ? calloutsFromFacts(c.facts) : [],
    colours,
    productPalette: colours.length === 0 && !!look?.productPalette,
    finish: look?.finish,
    headScale: look?.typeScale ?? 1,
    notes: note ? [note] : [],
  };
}

/** The effect choice from a request: an id with an intensity and the stylise switch, "none", or unset. */
export function effectFromRequest(raw: unknown): EffectSpec | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "none") return null;
  if (typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.id === "none") return null;
  const info = effectById(typeof r.id === "string" ? r.id : "");
  if (!info) return undefined;
  return { id: info.id, intensity: clampIntensity(r.intensity), ...(r.stylise === true ? { stylise: true } : {}) };
}

/** Words for the planner: the Look's voice and the Theme's copy angle. */
export function styleVoice(s: Style): string {
  const parts = [s.look?.voice, s.theme?.mood ? `The mood of the occasion is ${s.theme.mood}.` : "", s.theme?.angle].filter(Boolean);
  return parts.length ? `Voice and occasion: ${parts.join(" ")} ` : "";
}

// Scenery the image model must never be asked for: the occasion is palette, layout and copy, not props.
const SCENERY = /\b(snow\w*|bauble\w*|ornament\w*|christmas tree|tree lights|santa|reindeer|tinsel|wreath|holly|mistletoe|pumpkin\w*|falling leaves|autumn leaves|fireworks|confetti|ribbon\w*|gift[- ]?wrap\w*|candy cane\w*|jack[- ]o[- ]lantern\w*|ghost\w*|witch\w*|cobweb\w*|spider\w*|skull\w*|skeleton\w*|calavera\w*|altar\w*|ofrenda\w*|saint\w*|crucifix\w*|crosses|cross|rosary|marigold\w*|papel picado|bunn(?:y|ies)|easter eggs?|chocolate eggs?|cupid\w*|hearts?|roses?|balloon\w*|champagne|sparkler\w*|streamer\w*|blossom\w*|petals?|beach\w*|seashell\w*|palm trees?|sunbeds?|school bus|chalkboard\w*|apple\w*)\b/gi;

/** Removes any seasonal scenery from an art prompt. */
export function stripScenery(artPrompt: string): string {
  return artPrompt.replace(SCENERY, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

export const lookExists = (id: string | undefined): boolean => !!lookById(id);

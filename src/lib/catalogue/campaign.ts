// A campaign is the three choices for a catalogue: the Look (how the ads are made), the Theme (the occasion) and the Effect,
// plus the offer a sale theme needs. Pure and browser safe. One product can override the Look or the Effect.
import { LOOKS, lookById } from "../meta/looks.js";
import { THEMES, checkOffer, themeById } from "../meta/themes.js";
import { EFFECTS, clampIntensity, effectById, type EffectId } from "../meta/effectInfo.js";

export interface EffectChoice {
  id: "default" | "none" | EffectId; // default is the Look's own effect, if it has one
  intensity: number; // 0 to 100
  stylise: boolean; // "Stylise the product too": off unless turned on
}

export interface Campaign {
  look: string;
  theme: string;
  effect: EffectChoice;
  offer: string; // typed by the person; a sale theme will not run without one
}

export interface Override {
  look?: string;
  effect?: EffectChoice;
}

export const DEFAULT_EFFECT: EffectChoice = { id: "default", intensity: 70, stylise: false };
export const DEFAULT_CAMPAIGN: Campaign = { look: "loud", theme: "evergreen", effect: DEFAULT_EFFECT, offer: "" };

/** The campaign with one product's override on top. */
export function effectiveFor(c: Campaign, o: Override | undefined): Campaign {
  return { ...c, look: o?.look ?? c.look, effect: o?.effect ?? c.effect };
}

/** The style fields of a run request. effect is left out for "default", so the Look's own effect applies. */
export function requestStyle(c: Campaign): Record<string, unknown> {
  const out: Record<string, unknown> = { look: c.look, theme: c.theme };
  if (c.effect.id === "none") out.effect = "none";
  else if (c.effect.id !== "default") out.effect = { id: c.effect.id, intensity: clampIntensity(c.effect.intensity), stylise: c.effect.stylise === true };
  if (c.offer.trim()) out.offer = c.offer.trim();
  return out;
}

/** Why a campaign cannot run yet, in one plain sentence, or null. */
export function campaignProblem(c: Campaign): string | null {
  const check = checkOffer(themeById(c.theme), c.offer);
  return check.ok ? null : check.error;
}

const sane = (v: unknown): v is Campaign => {
  const c = v as Campaign | null;
  return !!c && typeof c === "object" && !!lookById(c.look) && !!themeById(c.theme) && typeof c.offer === "string" && !!c.effect && (c.effect.id === "default" || c.effect.id === "none" || !!effectById(c.effect.id));
};

/** A saved campaign read back from browser storage: anything that is not a valid campaign is dropped. */
export function cleanCampaign(v: unknown): Campaign | null {
  if (!sane(v)) return null;
  return { look: v.look, theme: v.theme, offer: v.offer.slice(0, 140), effect: { id: v.effect.id, intensity: clampIntensity(v.effect.intensity), stylise: v.effect.stylise === true } };
}

export const EFFECT_OPTIONS: ReadonlyArray<{ id: EffectChoice["id"]; name: string; description: string; swatch: readonly string[] }> = [
  { id: "default", name: "The Look's own", description: "Pop Art starts with the Pop Art effect; the other Looks start with none.", swatch: ["#DDDDDD", "#999999", "#555555"] },
  { id: "none", name: "No effect", description: "Plain background, true colour everywhere.", swatch: ["#FFFFFF", "#DDDDDD", "#BBBBBB"] },
  ...EFFECTS.map((e) => ({ id: e.id as EffectChoice["id"], name: e.name, description: e.description, swatch: e.swatch })),
];

export { LOOKS, THEMES };

/** The layout an ad is redrawn on when its Look changes: the one it has when the new Look allows it, else the Look's first. */
export function archetypeFor(lookId: string, current: "behind" | "product"): "behind" | "product" {
  const l = lookById(lookId);
  const allowed = (l?.layouts ?? []).filter((x): x is "behind" | "product" => x === "behind" || x === "product");
  if (!allowed.length || allowed.includes(current)) return current;
  return allowed[0];
}

/** The effect after this one, in the order each effect then none, so repeated clicks go round them all. */
export function nextEffect(current: { id: string } | null | undefined, ids: readonly string[]): string {
  const order = [...ids, "none"];
  const at = current ? order.indexOf(current.id) : order.length - 1;
  return order[(at + 1) % order.length];
}

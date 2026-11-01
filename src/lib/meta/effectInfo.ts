// The effects as plain data: ids, names, descriptions, preview swatches, the stylise warning and request cleaning. Pure and browser
// safe; the image code that draws them is in design/effects.ts.
export type EffectId = "popart" | "duotone" | "halftone" | "neon";
export const EFFECT_IDS: readonly EffectId[] = ["popart", "duotone", "halftone", "neon"];

export interface EffectSpec {
  id: EffectId;
  intensity: number; // 0 to 100
  stylise?: boolean; // recolour the product too; off unless the person turns it on
}

export interface EffectInfo {
  id: EffectId;
  name: string;
  description: string;
  swatch: readonly [string, string, string];
}

export const EFFECTS: readonly EffectInfo[] = [
  { id: "popart", name: "Pop Art", description: "Flat posterised colour, halftone dots that are largest near the product and fade outward, and a burst behind it and to one side.", swatch: ["#FFD400", "#FF3B5C", "#111111"] },
  { id: "duotone", name: "Duotone", description: "The background in two tones only: the dark and an accent colour.", swatch: ["#101820", "#2F6FED", "#F4F6F8"] },
  { id: "halftone", name: "Halftone", description: "The background as a printed dot screen.", swatch: ["#F4F1EA", "#1F1D1A", "#8A7F70"] },
  { id: "neon", name: "Neon Outline", description: "A dark background with a glowing line round the product.", swatch: ["#0A0A14", "#00F0FF", "#FF2BD6"] },
];

export const effectById = (id: string | undefined | null): EffectInfo | null => EFFECTS.find((e) => e.id === id) ?? null;

export const STYLISED_NOTE = "Stylised: the product colour was changed on purpose.";
export const DEFAULT_INTENSITY = 70;

export const clampIntensity = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : DEFAULT_INTENSITY);

/** Cleans an effect from a request. Null when it is not a usable effect. */
export function cleanEffect(raw: unknown): EffectSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = EFFECT_IDS.find((e) => e === r.id);
  if (!id) return null;
  return { id, intensity: clampIntensity(r.intensity), ...(r.stylise === true ? { stylise: true } : {}) };
}


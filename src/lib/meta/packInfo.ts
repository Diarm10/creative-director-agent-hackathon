// What a campaign pack holds, with no dependencies, so the page and the server say the same thing.
export const PACK_SIZES = [
  { id: "square", width: 1080, height: 1080 },
  { id: "story", width: 1080, height: 1920 },
  { id: "poster", width: 1200, height: 1800 },
] as const;
export type PackSizeId = (typeof PACK_SIZES)[number]["id"];
export type PackArchetype = "typographic" | "artwork" | "product" | "behind";

/** Whether a design is built on a generated picture, which exists at one size only. */
export const needsScene = (archetype: PackArchetype): boolean => archetype === "artwork";

/** Which sizes a pack can hold for a design, and why any is missing. */
export function packAvailability(archetype: PackArchetype): Array<{ id: PackSizeId; available: boolean; reason?: string }> {
  return PACK_SIZES.map((s) =>
    needsScene(archetype) && s.id !== "square"
      ? { id: s.id, available: false, reason: "this design is built on a generated picture made at one size, and a new size would need a new picture" }
      : { id: s.id, available: true },
  );
}

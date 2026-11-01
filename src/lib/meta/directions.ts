// The first three rounds of a normal run are three different creative directions, not three variations of one idea.
// The direction fixes the layout family (so the rounds really differ) and tells the planner what idea to execute.
// A revision refines the round it came from and keeps that round's layout.
import type { BriefType, PlanArchetype, VariantName } from "./creativeDirectorPure.js";

export interface Direction {
  id: string;
  archetype: PlanArchetype;
  label: string; // short, shown on the round card
  idea: string; // what the planner is asked to make
  variant?: VariantName; // for typographic designs, the composition this direction uses
}

const PRODUCT: readonly Direction[] = [
  {
    id: "type-behind",
    archetype: "behind",
    label: "Type behind product",
    idea:
      "Type behind the product: one short, bold headline of at most four words, set huge behind the real product, which overlaps it, on a bold colour field. " +
      "colours: put a strong brand colour first, because it becomes the field.",
  },
  {
    id: "scene",
    archetype: "artwork",
    label: "Photographic scene",
    idea: "A photographic scene: the real product photographed in a believable setting that suits the audience, with the type on a calm area above it.",
  },
  {
    id: "studio",
    archetype: "product",
    label: "Clean studio",
    idea: "A clean studio shot: the real product large on one calm palette background, with the type set plainly above it.",
  },
];

const GRAPHIC: readonly Direction[] = [
  {
    id: "colour-block",
    archetype: "typographic",
    variant: "block",
    label: "Bold colour block",
    idea: "A bold colour block: the headline on a solid block of brand colour, huge and plain. No picture.",
  },
  {
    id: "scene",
    archetype: "artwork",
    label: "Photographic scene",
    idea: "A photographic or illustrated scene that carries the mood, with clean type on a calm area of it.",
  },
  {
    id: "line-pattern",
    archetype: "typographic",
    variant: "anchor",
    label: "Line pattern poster",
    idea: "A type poster over a geometric line pattern: details at the top, the headline anchored at the foot. No picture.",
  },
];

/** With a cut-out that is not clean enough for type behind the product, the product ad starts from the studio shot. */
const PRODUCT_WITHOUT_BEHIND: readonly Direction[] = [PRODUCT[2], PRODUCT[1]];

/** When the cut-out failed, only the studio layout on the original photo is made: a scene would be built from a bad cut-out. */
const PANEL_ONLY: readonly Direction[] = [PRODUCT[2]];

/** The direction for round 1, 2 or 3 of a normal run. Null for any other round, such as a revision. */
/** The product directions in a Look's preference order, without any the cut-out cannot support. */
function directionsForLook(look: { layouts: readonly PlanArchetype[] }, opts: { behindOk?: boolean; panel?: boolean }): readonly Direction[] {
  if (opts.panel) return PANEL_ONLY;
  const list = look.layouts.map((a) => PRODUCT.find((d) => d.archetype === a)).filter((d): d is Direction => !!d && (d.archetype !== "behind" || opts.behindOk !== false));
  return list.length ? list : PRODUCT_WITHOUT_BEHIND;
}

export function directionForRound(type: BriefType, round: number, opts: { behindOk?: boolean; panel?: boolean; look?: { layouts: readonly PlanArchetype[] } | null } = {}): Direction | null {
  if (type === "product" && opts.look) {
    const list = directionsForLook(opts.look, opts);
    return round >= 1 && round <= list.length ? list[round - 1] : null;
  }
  // A cut-out that failed its sanity check is not used at all: the one design is the studio layout on the whole photo.
  const list = type === "product" ? (opts.panel ? PANEL_ONLY : opts.behindOk === false ? PRODUCT_WITHOUT_BEHIND : PRODUCT) : GRAPHIC;
  return round >= 1 && round <= list.length ? list[round - 1] : null;
}

export const DIRECTION_LABELS: Record<string, string> = Object.fromEntries([...PRODUCT, ...GRAPHIC].map((d) => [d.id, d.label]));

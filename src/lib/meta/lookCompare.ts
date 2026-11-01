// Did a revision really change the ad? Each finished ad carries a 256 bit look (a difference hash of a 17 by 16 grey copy of
// the picture). Two ads with the same copy and a look that differs by only a few bits are the same ad. Pure and browser
// safe: the server makes the look (look.ts), the page compares them.

/** Bits of 256 that may differ between two looks that are still "the same picture": JPEG noise and sub-pixel shifts move a few. */
export const SAME_LOOK_BITS = 6;

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** How many of the 256 bits differ. 256 (as different as can be) when either look is missing or malformed. */
export function lookDistance(a: string | undefined, b: string | undefined): number {
  if (!a || !b || a.length !== 64 || b.length !== 64) return 256;
  let bits = 0;
  for (let i = 0; i < 64; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (Number.isNaN(x)) return 256;
    bits += POP[x];
  }
  return bits;
}

interface Comparable {
  round: number;
  headline: string;
  body: string;
  cta?: string;
  look?: string;
  revisionOf?: { round: number; note: string; applied?: string[]; ignored?: string[] };
}

export const NO_CHANGE = "Nothing changed.";

export interface RevisionOutcome {
  changed: boolean;
  message: string | null; // set when nothing changed: what to tell the person
}

/** For a revised round: whether it differs from the round it revised, and a plain message when it does not. */
export function revisionOutcome(concepts: readonly Comparable[], revised: Comparable): RevisionOutcome {
  const from = revised.revisionOf;
  if (!from) return { changed: true, message: null };
  const base = concepts.find((c) => c.round === from.round);
  if (!base) return { changed: true, message: null };
  const sameCopy = base.headline === revised.headline && base.body === revised.body && (base.cta ?? "") === (revised.cta ?? "");
  // Unchanged: the same words and either the same picture, or nothing the engine did to it (a new photographic scene is a new
  // random picture, not a change the note asked for).
  if (sameCopy && (lookDistance(base.look, revised.look) <= SAME_LOOK_BITS || (from.applied ?? []).length === 0)) {
    const ignored = from.ignored ?? [];
    const why = ignored.length
      ? ignored.join("; ")
      : from.note
        ? "it did not match anything the layout can change"
        : "no note was given, so nothing was asked for";
    return { changed: false, message: `${NO_CHANGE} I could not act on that note: ${why}.` };
  }
  return { changed: true, message: null };
}

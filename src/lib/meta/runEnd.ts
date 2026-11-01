// NEW FOR HACKATHON. When a Creative Director run stops, and the plain sentence that says why.
// Pure and browser safe: the loop decides with it, the page words the result with it.

export const PASS_SCORE = 8; // the bar: a round at or above this meets it
export const EARLY_STOP_SCORE = 9; // a first round this good needs no revision
export const MIN_ROUNDS = 2; // a normal run shows at least one revision unless round 1 scores EARLY_STOP_SCORE
export const MAX_REVISION_ROUND = 12; // revisions add rounds after the usual three; the numbering stops here
export const RUN_BUDGET_MS = 270_000; // Vercel gives the function 300 s; no round starts that could not finish inside this

export type StopReason = "early_high" | "bar_met" | "max_rounds" | "time_limit" | "single_pass" | "revision" | "error" | "dropped";

export interface RoundCheck {
  round: number; // the round that just finished, counting from 1
  score: number;
  maxRounds: number;
  elapsedMs: number; // since the run started
  lastRoundMs: number; // how long the round that just finished took
}

/**
 * Whether the run stops after a round, and why. null means go on. The time guard is the last rule, so
 * it can also cut the second round short; the run then says so instead of pretending it was done.
 */
export function decideAfterRound(c: RoundCheck): StopReason | null {
  if (c.round === 1 && c.score >= EARLY_STOP_SCORE) return "early_high";
  if (c.round >= c.maxRounds) return c.score >= PASS_SCORE ? "bar_met" : "max_rounds";
  if (c.round >= MIN_ROUNDS && c.score >= PASS_SCORE) return "bar_met";
  if (c.elapsedMs + c.lastRoundMs * 1.2 > RUN_BUDGET_MS) return "time_limit";
  return null;
}

export interface EndInfo {
  rounds: number; // rounds finished
  bestScore: number;
  fromRound?: number; // revisions: the round that was revised
}

const roundsText = (n: number) => `${n} round${n === 1 ? "" : "s"}`;

/** The sentence shown in the progress box when a run has ended. No dashes. */
export function describeEnd(reason: StopReason, info: EndInfo): string {
  switch (reason) {
    case "early_high":
      return `Finished after 1 round: the critic scored ${info.bestScore}/10, so no revision was needed.`;
    case "bar_met":
      return `Finished after ${roundsText(info.rounds)}: the critic scored ${info.bestScore}/10, which meets the bar of ${PASS_SCORE}.`;
    case "max_rounds":
      return `Finished after ${roundsText(info.rounds)}: the best score was ${info.bestScore}/10, below the bar of ${PASS_SCORE}.`;
    case "time_limit":
      return `Stopped: time limit. ${roundsText(info.rounds)} finished (best ${info.bestScore}/10). Another round would not fit inside the ${RUN_BUDGET_MS / 1000} second limit.`;
    case "single_pass":
      return "Finished: a marketplace listing is built in one pass from the real photo.";
    case "revision":
      return `Finished: the revision of round ${info.fromRound ?? "?"} scored ${info.bestScore}/10.`;
    case "error":
      return "Stopped: error, see below.";
    case "dropped":
      return "Stopped: the connection dropped before the run finished. Showing what arrived.";
  }
}

/** Reasons where running again is the useful next step. */
export const RETRYABLE: readonly StopReason[] = ["time_limit", "error", "dropped"];

export interface PickCandidate {
  round: number;
  score: number;
  archetype?: string;
  legibility?: number; // the critic's score for the part, when there is one
  composition?: number;
}

/**
 * Whether b beats a. Higher score wins. On an equal score the round with the higher legibility wins, then the higher
 * composition, then a photographic scene over any other layout, and last the later round. Type behind the product gets no
 * preference of its own: it has to win on the numbers.
 */
export function beats(b: PickCandidate, a: PickCandidate): boolean {
  if (b.score !== a.score) return b.score > a.score;
  if ((b.legibility ?? 0) !== (a.legibility ?? 0)) return (b.legibility ?? 0) > (a.legibility ?? 0);
  if ((b.composition ?? 0) !== (a.composition ?? 0)) return (b.composition ?? 0) > (a.composition ?? 0);
  const scene = (c: PickCandidate) => (c.archetype === "artwork" ? 1 : 0);
  if (scene(b) !== scene(a)) return scene(b) > scene(a);
  return true; // still tied: the later round
}

/** The index of the best round by the rule above. */
export function pickBest(rounds: readonly PickCandidate[]): number {
  let best = 0;
  for (let i = 1; i < rounds.length; i++) if (beats(rounds[i], rounds[best])) best = i;
  return best;
}

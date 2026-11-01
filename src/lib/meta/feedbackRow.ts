// NEW FOR HACKATHON. Builds the feedback entry the browser saves. One function, used by the feedback
// panel and by tests, so the entry is always limited, sanitised and text and numbers only.
import { sanitizeFeedbackText, FEEDBACK_MAX } from "./feedbackSafety.js";

export type Direction = "too_low" | "about_right" | "too_high";
export const DIRECTIONS: readonly Direction[] = ["too_low", "about_right", "too_high"];

export interface FeedbackRowContext {
  productFolioId: string | null;
  audience: string;
  briefType: "product" | "event" | "promo";
  channel: string;
}

export interface FeedbackConceptInput {
  round: number;
  headline: string;
  score: number;
  breakdown?: { parts: Record<string, { score: number; note: string }>; capReason: string | null } | null;
}

const clamp10 = (n: number) => Math.max(1, Math.min(10, Math.round(n)));

/** Which way the person's score points, from the two scores. They can change it before saving. */
export function suggestDirection(criticScore: number, humanScore: number): Direction {
  return humanScore > criticScore ? "too_low" : humanScore < criticScore ? "too_high" : "about_right";
}

export function buildFeedbackRow(
  ctx: FeedbackRowContext,
  concept: FeedbackConceptInput,
  human: { score: number; direction: Direction; reason: string },
  createdAt: string = new Date().toISOString(),
) {
  const parts: Record<string, { score: number; note: string }> = {};
  for (const [k, v] of Object.entries(concept.breakdown?.parts ?? {})) {
    parts[k] = { score: clamp10(v.score), note: sanitizeFeedbackText(v.note, 160) };
  }
  return {
    product_folio_id: ctx.productFolioId,
    audience: sanitizeFeedbackText(ctx.audience, 200),
    brief_type: ctx.briefType,
    channel: ctx.channel,
    round: Math.max(1, Math.min(12, Math.round(concept.round))),
    headline: sanitizeFeedbackText(concept.headline, 120),
    critic_overall: clamp10(concept.score),
    critic_parts: parts,
    critic_cap_reason: concept.breakdown?.capReason ? sanitizeFeedbackText(concept.breakdown.capReason, 300) : null,
    human_score: clamp10(human.score),
    direction: DIRECTIONS.includes(human.direction) ? human.direction : suggestDirection(concept.score, human.score),
    reason: sanitizeFeedbackText(human.reason, FEEDBACK_MAX),
    created_at: createdAt,
  };
}

/** The feedback row for a text edit: the person's own words before and after, so the export carries the change. */
export function editReason(before: { headline: string; body: string; cta: string }, after: { headline: string; body: string; cta: string }): string {
  const one = (t: { headline: string; body: string; cta: string }) => [t.headline, t.body, t.cta].filter(Boolean).map((x) => `"${x}"`).join(" / ");
  return `Text edit by the person, not a score. Before: ${one(before)}. After: ${one(after)}.`;
}

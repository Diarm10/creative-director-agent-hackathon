// NEW FOR HACKATHON. Exported feedback data: one labelled example per line (JSONL), made from the
// feedback saved in this browser. Text and numbers only, never images. The file exists so the labelled
// examples can be reused later; nothing in this app trains a model on them.
import { sanitizeFeedbackText } from "./feedbackSafety.js";

export interface FeedbackExportRow {
  created_at: string;
  brief_type: string;
  channel: string;
  audience: string;
  headline: string;
  product_folio_id: string | null;
  round: number | null;
  critic_overall: number;
  critic_parts: Record<string, { score?: number; note?: string }> | null;
  critic_cap_reason: string | null;
  human_score: number;
  direction: string;
  reason: string;
}

export interface ExportedExample {
  brief: { type: string; channel: string; audience: string; headline: string; product_folio_id: string | null; round: number | null };
  critic: { overall: number; parts: Record<string, { score: number; note: string }>; cap_reason: string | null };
  human: { score: number; direction: string; reason: string };
  created_at: string;
}

/** One labelled example: the brief, the critic's per-part scores and notes, and the person's score and reason. */
export function toExample(row: FeedbackExportRow): ExportedExample {
  const parts: Record<string, { score: number; note: string }> = {};
  for (const [k, v] of Object.entries(row.critic_parts ?? {})) {
    if (v && typeof v.score === "number") parts[k] = { score: v.score, note: sanitizeFeedbackText(v.note ?? "", 160) };
  }
  return {
    brief: {
      type: row.brief_type,
      channel: row.channel,
      audience: sanitizeFeedbackText(row.audience, 200),
      headline: sanitizeFeedbackText(row.headline, 120),
      product_folio_id: row.product_folio_id,
      round: row.round,
    },
    critic: { overall: row.critic_overall, parts, cap_reason: row.critic_cap_reason ? sanitizeFeedbackText(row.critic_cap_reason, 300) : null },
    human: { score: row.human_score, direction: row.direction, reason: sanitizeFeedbackText(row.reason, 300) },
    created_at: row.created_at,
  };
}

/** The file body: one JSON object per line, oldest first, ending with a newline. Empty input gives an empty file. */
export function toJsonl(rows: readonly FeedbackExportRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return sorted.map((r) => JSON.stringify(toExample(r))).join("\n") + (sorted.length ? "\n" : "");
}

export const EXPORT_FILE_BASENAME = "exported-feedback-data";

export interface FeedbackFile {
  count: number;
  text: string;
  fileName: string; // the name the download is saved under
  message: string; // what the person is told, in plain words
}

/** What "Export feedback data" does: the file, and the sentence that says what was saved. Nothing is downloaded for no records. */
export function feedbackFile(rows: readonly FeedbackExportRow[], date: string): FeedbackFile {
  const fileName = `${EXPORT_FILE_BASENAME}-${date}.jsonl`;
  const text = toJsonl(rows);
  const count = rows.length;
  return {
    count,
    text,
    fileName,
    message: count === 0 ? "No feedback saved yet. Save a score on an ad first, then export." : `Saved ${fileName} with ${count} record${count === 1 ? "" : "s"}.`,
  };
}

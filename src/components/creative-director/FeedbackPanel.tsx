// NEW FOR HACKATHON. The score breakdown for a round, and a place to correct it. Saved corrections are
// quoted back to the critic as calibration examples in later runs (client memory, kept in this browser).
// This is prompt calibration from saved feedback, not model training.
import { useEffect, useMemo, useState } from 'react';
import { addFeedback, setWinnerHumanScore, updateFeedback } from '../../lib/browser/store';
import { sanitizeFeedbackText } from '../../lib/meta/feedbackSafety';
import { buildFeedbackRow, suggestDirection, type Direction as RowDirection } from '../../lib/meta/feedbackRow';
import ExportFeedback from '../ExportFeedback';
import { PART_KEYS, type Concept, type PartKey, type RunStatus } from './runState';

export type Direction = RowDirection;
export type BriefKind = 'product' | 'event' | 'promo';

export interface FeedbackContext {
  productFolioId: string | null;
  audience: string;
  briefType: BriefKind;
  channel: string;
}

export interface SavedFeedback {
  id: string;
  humanScore: number;
  direction: Direction;
  reason: string;
}

const REASON_MAX = 300;

export const DIRECTION_LABEL: Record<Direction, string> = { too_low: 'Too low', about_right: 'About right', too_high: 'Too high' };

export function partLabel(key: PartKey, briefType: BriefKind, hasProduct: boolean): string {
  if (key === 'legibility') return 'Type legibility';
  if (key === 'hierarchy') return 'Hierarchy';
  if (key === 'composition') return 'Composition';
  if (key === 'brandFit') return 'Brand fit';
  if (key === 'originality') return 'Originality';
  return hasProduct ? 'Product fidelity' : briefType === 'event' ? 'Event fit' : 'Promo fit';
}

const button = 'rounded-md border px-2.5 py-1 text-xs';
const selected = 'border-[var(--cm-accent)] bg-[var(--cm-accent-subtle)] text-[var(--cm-text-primary)]';
const idle = 'border-[var(--cm-border)] bg-transparent text-[var(--cm-text-secondary)]';

interface Props {
  concepts: Concept[];
  status: RunStatus;
  finalPickIndex: number | null;
  memoryId: string | null;
  briefType: BriefKind;
  hasProduct: boolean;
  ctx: FeedbackContext | null;
  saved: Record<number, SavedFeedback>;
  onSaved: (round: number, fb: SavedFeedback) => void;
}

export default function FeedbackPanel({ concepts, status, finalPickIndex, memoryId, briefType, hasProduct, ctx, saved, onSaved }: Props) {
  const done = status === 'done';
  const [round, setRound] = useState<number | null>(null);
  const current = concepts.find((c) => c.round === round) ?? (done && finalPickIndex !== null ? concepts[finalPickIndex] : concepts[concepts.length - 1]);

  const [score, setScore] = useState<number | null>(null);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Switching round loads that round's saved feedback into the form, or clears it.
  const currentRound = current?.round ?? null;
  useEffect(() => {
    const s = currentRound !== null ? saved[currentRound] : undefined;
    setScore(s?.humanScore ?? null);
    setDirection(s?.direction ?? null);
    setReason(s?.reason ?? '');
    setMessage(null);
  }, [currentRound, saved]);

  const parts = current?.breakdown?.parts;
  const canSave = done && !!ctx && !!current && score !== null && direction !== null && !busy;
  const cleanReason = useMemo(() => sanitizeFeedbackText(reason, REASON_MAX), [reason]);

  function save() {
    if (!ctx || !current || score === null || direction === null) return;
    setBusy(true);
    const row = buildFeedbackRow(ctx, current, { score, direction, reason: cleanReason });
    const existing = saved[current.round];
    let id: string;
    if (existing) {
      updateFeedback(existing.id, row as Parameters<typeof updateFeedback>[1]);
      id = existing.id;
    } else {
      id = addFeedback(row as Parameters<typeof addFeedback>[0]);
    }
    // My score on the final pick is also kept with that run's saved winner.
    if (memoryId && finalPickIndex !== null && concepts[finalPickIndex]?.round === current.round) setWinnerHumanScore(memoryId, score);
    onSaved(current.round, { id, humanScore: score, direction, reason: cleanReason });
    setMessage('Saved in this browser');
    setBusy(false);
  }

  if (!current) {
    return (
      <div className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4 text-xs text-[var(--cm-text-muted)]">
        The score breakdown and feedback appear here as each round finishes.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4" aria-label="Score breakdown and feedback">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {concepts.map((c) => (
          <button key={c.round} type="button" onClick={() => setRound(c.round)} className={`${button} ${c.round === current.round ? selected : idle}`}>
            Round {c.round}
          </button>
        ))}
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">Critic score</span>
        <span className="text-sm font-bold text-[var(--cm-text-primary)]">{current.score}/10</span>
      </div>
      {current.breakdown?.capReason && (
        <div className="mb-2 rounded-md border border-[var(--cm-border-strong)] px-2 py-1 text-[11px] text-[var(--cm-text-primary)]">{current.breakdown.capReason}</div>
      )}
      {parts ? (
        <ul className="m-0 mb-4 flex list-none flex-col gap-2 p-0">
          {PART_KEYS.map((key) => (
            <li key={key}>
              <div className="flex items-center justify-between text-xs text-[var(--cm-text-primary)]">
                <span>{partLabel(key, briefType, hasProduct)}</span>
                <span className="font-semibold">{parts[key].score}/10</span>
              </div>
              <div className="my-1 h-1 overflow-hidden rounded-full bg-[var(--cm-border)]">
                <div className="h-full bg-[var(--cm-accent)]" style={{ width: `${parts[key].score * 10}%` }} />
              </div>
              <div className="text-[11px] leading-snug text-[var(--cm-text-muted)]">{parts[key].note}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-[11px] text-[var(--cm-text-muted)]">No per-part breakdown for this round.</p>
      )}

      <div className="border-t border-[var(--cm-border)] pt-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">Your score for round {current.round}</div>
        {!done && <p className="mb-2 text-[11px] text-[var(--cm-text-muted)]">You can add feedback when the run has finished.</p>}
        <div className="mb-2 flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" disabled={!done} onClick={() => { setScore(n); setDirection(suggestDirection(current.score, n)); }}
              className={`${button} min-w-[28px] ${score === n ? selected : idle} disabled:opacity-50`} aria-pressed={score === n}>{n}</button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Was the critic's score too low, about right or too high?">
          {(Object.keys(DIRECTION_LABEL) as Direction[]).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={direction === d} disabled={!done} onClick={() => setDirection(d)}
              className={`${button} ${direction === d ? selected : idle} disabled:opacity-50`}>{DIRECTION_LABEL[d]}</button>
          ))}
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))} maxLength={REASON_MAX} rows={3} disabled={!done}
          placeholder="Why? For example: the date is too small, or the green is right for this brand."
          className="mb-1 w-full resize-y rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg)] px-2 py-1.5 text-xs text-[var(--cm-text-primary)] disabled:opacity-50" />
        <div className="mb-2 text-right text-[10px] text-[var(--cm-text-muted)]">{reason.length}/{REASON_MAX}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={!canSave}>{saved[current.round] ? 'Update feedback' : 'Save feedback'}</button>
          {message && <span role="status" className="text-[11px] text-[var(--cm-text-secondary)]">{message}</span>}
        </div>
        <p className="mb-0 mt-3 text-[10px] leading-snug text-[var(--cm-text-muted)]">
          Saved feedback stays in this browser and is quoted to the critic as calibration the next time you make something for the same brand. It is not model training.
        </p>
      </div>

      <div className="mt-3 border-t border-[var(--cm-border)] pt-3">
        <ExportFeedback />
      </div>
    </div>
  );
}

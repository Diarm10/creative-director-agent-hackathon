// NEW FOR HACKATHON. One round's result: image, copy (or listing title and bullets), checks, score.
import { useEffect, useState } from 'react';
import { STEP_NAME, modelText, type Concept } from './runState';
import { DIRECTION_LABEL, type SavedFeedback } from './FeedbackPanel';

const METHOD_LABEL: Record<string, string> = {
  'type behind product': 'Type behind product',
  'one-pass edit': 'Real product, one pass',
  'layout composite': 'Real product, composited',
  typographic: 'Typographic',
  artwork: 'Artwork',
};

const badge = 'rounded-full border border-[var(--cm-border)] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[10px] font-bold text-[var(--cm-text-muted)]';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Counts up to the score once, unless the user prefers reduced motion. */
function AnimatedScore({ score }: { score: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? score : 0));
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(score); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      setShown(Math.round(score * t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);
  return (
    <div className="ml-auto flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--cm-border)]">
        <div className="h-full bg-[var(--cm-accent)] transition-[width] duration-500" style={{ width: `${shown * 10}%` }} />
      </div>
      <span className="text-xs text-[var(--cm-text-secondary)]">Score {shown}/10</span>
    </div>
  );
}

interface Props {
  concept: Concept;
  isFinal: boolean;
  feedback?: SavedFeedback;
  onRevise?: () => void; // set when this round can be revised now: feedback is saved and nothing is running
  unchanged?: string | null; // set when this round is a revision that changed nothing: what to tell the person
}

export default function RoundCard({ concept: c, isFinal, feedback, onRevise, unchanged }: Props) {
  return (
    <div className={`flex flex-wrap gap-4 rounded-xl border bg-[var(--cm-surface)] p-4 animate-fade-up ${isFinal ? 'border-[var(--cm-accent)]' : 'border-[var(--cm-border)]'}`}>
      {c.imageB64 ? (
        <img src={`data:${c.imageMime};base64,${c.imageB64}`} alt={c.headline}
          className="h-[220px] w-[220px] max-w-full flex-shrink-0 rounded-lg bg-[var(--cm-bg)] object-contain" />
      ) : (
        <div className="flex h-[220px] w-[220px] max-w-full flex-shrink-0 items-center justify-center rounded-lg bg-[var(--cm-bg)] text-xs text-[var(--cm-text-muted)]">Image unavailable</div>
      )}
      <div className="min-w-[200px] flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">
            Round {c.round}
          </span>
          {c.direction && <span className={badge} data-direction>{c.direction}</span>}
          {c.revisionOf && <span className={badge} data-revision-of={c.revisionOf.round}>Revision of round {c.revisionOf.round}</span>}
          {isFinal && <span className="stage-badge active">Final pick</span>}
          <span className={badge}>{METHOD_LABEL[c.method] ?? c.method}</span>
          {!c.fidelity.sameProduct && (
            <span className={badge}>Fidelity mismatch{c.fidelity.differences.length ? `: ${c.fidelity.differences.join(', ')}` : ''}</span>
          )}
          <AnimatedScore score={c.score} />
        </div>

        {!c.folioCheck.passed && (
          <div className="mb-2 rounded-md border border-[var(--cm-border-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--cm-text-primary)]">
            Blocked by folio: {c.folioCheck.reason ?? 'unapproved claim'}
          </div>
        )}

        {c.revisionOf && (
          <div className="mb-2 rounded-md border border-[var(--cm-border)] px-2.5 py-1.5 text-xs text-[var(--cm-text-secondary)]">
            {c.revisionOf.note ? <>Your note: &ldquo;{c.revisionOf.note}&rdquo;</> : 'No note from you, so this applied the critic’s weakest point only.'}
            {!unchanged && (c.revisionOf.applied?.length ?? 0) > 0 && <div data-applied>Changed: {c.revisionOf.applied?.join('; ')}.</div>}
          </div>
        )}
        {unchanged && (
          <div className="mb-2 rounded-md border border-[var(--cm-border-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--cm-text-primary)]" role="status" data-no-change>{unchanged}</div>
        )}
        <div className="mb-1.5 text-base font-bold text-[var(--cm-text-primary)]">{c.headline}</div>
        <div className="mb-2 text-[13px] leading-relaxed text-[var(--cm-text-secondary)]">{c.body}</div>
        {c.cta && (
          <div className="mb-2.5 flex items-center gap-2 text-[11px] text-[var(--cm-text-muted)]">
            Call to action <span className="stage-badge active">{c.cta}</span>
          </div>
        )}
        {c.breakdown?.capReason ? (
          <div className="mb-2 rounded-md border border-[var(--cm-border-strong)] px-2.5 py-1.5 text-xs text-[var(--cm-text-primary)]">{c.breakdown.capReason}</div>
        ) : c.defects.length > 0 ? (
          <div className="mb-2 rounded-md border border-[var(--cm-border-strong)] px-2.5 py-1.5 text-xs text-[var(--cm-text-primary)]">
            <span className="font-semibold">Score capped at 4:</span> {c.defects.join('; ')}
          </div>
        ) : null}
        {c.folioCheck.passed && <div className="text-xs leading-relaxed text-[var(--cm-text-muted)]">{c.critique}</div>}
        {c.models && c.models.length > 0 && (
          <div className="mt-2 text-[11px] leading-relaxed text-[var(--cm-text-muted)]" aria-label="Models used this round">
            {c.models.map((m) => (
              <div key={m.step}>{STEP_NAME[m.step] ?? m.step}: {modelText(m)}</div>
            ))}
          </div>
        )}
        {feedback && (
          <div className="mt-2 rounded-md border border-[var(--cm-border)] px-2.5 py-1.5 text-xs text-[var(--cm-text-secondary)]">
            <span className="font-semibold text-[var(--cm-text-primary)]">Your score {feedback.humanScore}/10</span> ({DIRECTION_LABEL[feedback.direction].toLowerCase()})
            {feedback.reason ? `: ${feedback.reason}` : ''}
          </div>
        )}
        {c.notes.length > 0 && (
          <div className="mt-1.5 text-xs leading-relaxed text-[var(--cm-text-secondary)]">{c.notes.join(', ')}</div>
        )}
        {feedback && onRevise && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost" onClick={onRevise}>Revise with my feedback</button>
            <span className="text-[11px] text-[var(--cm-text-muted)]">One new round from this design, using your note and the critic&rsquo;s weakest point. It counts toward your daily limit.</span>
          </div>
        )}
      </div>
    </div>
  );
}

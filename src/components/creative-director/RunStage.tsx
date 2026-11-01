// NEW FOR HACKATHON. Runs one Creative Director request and shows it live: reads the NDJSON stream
// from api/run.ts, ticks off pipeline steps, shows the real cut-out as soon as SAM
// finishes and fills round cards as each round lands. When the run ends, the progress box says why
// (bar met, rounds used up, time limit, error, dropped connection) and offers a retry where it helps.
// "Revise with my feedback" starts one more round on a saved round and adds its card to the same list.
// A small game fills the wait, and a non-blocking bar says when the ads are ready.
import { useEffect, useReducer, useRef, useState } from 'react';
import type { CreativeChannel } from '../../lib/meta/brief';
import { buildWinnerRow } from '../../lib/meta/memory';
import { addWinner, getDemoCode, memoryForRun } from '../../lib/browser/store';
import { needsScene, packAvailability } from '../../lib/meta/packInfo';
import RoundCard from './RoundCard';
import FeedbackPanel, { type BriefKind, type FeedbackContext, type SavedFeedback } from './FeedbackPanel';
import WaitGame from './WaitGame';
import { MAX_REVISION_ROUND, RETRYABLE } from '../../lib/meta/runEnd';
import { revisionOutcome } from '../../lib/meta/lookCompare';
import {
  MAX_ROUNDS, initialRunState, modelText, markStreamEnded, nextRound, reduceRun, roundSteps, splitNdjson, startRevision, stepStatuses,
  type Revising, type RunState, type RunStatus, type StreamEvent,
} from './runState';

type Action = { kind: 'event'; event: StreamEvent } | { kind: 'ended' } | { kind: 'failed'; message: string } | { kind: 'revise'; rev: Revising };

function reducer(state: RunState, action: Action): RunState {
  if (action.kind === 'event') return reduceRun(state, action.event);
  if (action.kind === 'ended') return markStreamEnded(state);
  if (action.kind === 'revise') return startRevision(state, action.rev);
  // A network failure before the run started is an error; after, it is a dropped stream.
  return state.status === 'connecting' ? reduceRun(state, { type: 'error', message: action.message }) : markStreamEnded(state);
}

// The pipeline steps are named for what they do; the model behind a step is looked up by its model step.
const STEP_MODEL: Record<string, string> = { copy: 'planner', fidelity: 'fidelity', folio: 'folio', critique: 'critic' };

function Dot({ status }: { status: 'pending' | 'active' | 'done' }) {
  if (status === 'done') return <span className="inline-block h-2 w-2 rounded-full bg-[var(--cm-accent)]" />;
  if (status === 'active') return <span className="inline-block h-2 w-2 animate-pulse rounded-full border border-[var(--cm-accent)] motion-reduce:animate-none" />;
  return <span className="inline-block h-2 w-2 rounded-full border border-[var(--cm-border-strong)]" />;
}

interface Props {
  body: Record<string, unknown>;
  channel: CreativeChannel;
  briefType: BriefKind;
  hasProduct: boolean;
  feedbackContext: FeedbackContext | null;
  onStatusChange?: (status: RunStatus) => void;
  onRetry: () => void;
  active?: boolean; // false while another tab is showing: the ending and the ready toast are not shown then, so they cannot linger
}

export default function RunStage({ body, channel, briefType, hasProduct, feedbackContext, onStatusChange, onRetry, active = true }: Props) {
  const [state, dispatch] = useReducer(reducer, initialRunState);
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRevisionRef = useRef<{ rev: Revising; request: Record<string, unknown> } | null>(null);
  const [readyDismissed, setReadyDismissed] = useState(false);
  const [saved, setSaved] = useState<Record<number, SavedFeedback>>({});
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [packState, setPackState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const winnerAdded = useRef(false);

  /** Posts one request and feeds its NDJSON lines to the reducer. Used for the run and for each revision. */
  async function stream(requestBody: Record<string, unknown>) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-demo-code': getDemoCode() },
        // The saved feedback and past winners travel with the run (client memory); the server cleans them again.
        body: JSON.stringify({ ...requestBody, memory: memoryForRun() }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({}));
        dispatch({ kind: 'failed', message: payload.error ?? `Request failed (${res.status})` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitNdjson(buffer);
        buffer = rest;
        for (const event of events) dispatch({ kind: 'event', event });
      }
      for (const event of splitNdjson(buffer + '\n').events) dispatch({ kind: 'event', event });
      dispatch({ kind: 'ended' });
    } catch (e) {
      if (controller.signal.aborted) return;
      dispatch({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    void stream(body);
    return () => abortRef.current?.abort();
    // body is fixed for the life of this component; the parent remounts it for a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { onStatusChange?.(state.status); }, [state.status, onStatusChange]);

  // The final pick of a finished run is remembered in this browser, as a past winner for the next run.
  useEffect(() => {
    if (state.status !== 'done' || winnerAdded.current || state.finalPickIndex === null) return;
    const c = state.concepts[state.finalPickIndex];
    if (!c) return;
    winnerAdded.current = true;
    setWinnerId(addWinner(buildWinnerRow({
      folioId: feedbackContext?.productFolioId ?? null, audience: feedbackContext?.audience ?? '', briefType, headline: c.headline, body: c.body,
      archetype: c.archetype, paletteSummary: c.paletteSummary ?? '', criticScore: c.score,
    })));
  }, [state.status, state.finalPickIndex, state.concepts, feedbackContext, briefType]);

  const running = state.status === 'connecting' || state.status === 'running';
  const steps = roundSteps(channel);
  const statuses = stepStatuses(steps, state.roundEvents, running);
  const shownRound = Math.max(1, state.round);

  /** One new round on a round whose feedback is saved: its plan, my note and the critic's weakest point. */
  function revise(round: number) {
    const base = state.concepts.find((c) => c.round === round);
    const fb = saved[round];
    if (!base || !fb || running) return;
    const next = nextRound(state.concepts);
    if (next > MAX_REVISION_ROUND) return;
    const rev: Revising = { fromRound: round, round: next, note: fb.reason };
    const request = {
      ...body,
      revise: {
        fromRound: round, round: next, headline: base.headline, subline: base.body, cta: base.cta ?? '', plan: base.plan,
        note: fb.reason, weakness: base.weakness ?? '', fix: base.fix ?? '',
      },
    };
    lastRevisionRef.current = { rev, request };
    setReadyDismissed(false);
    dispatch({ kind: 'revise', rev });
    void stream(request);
  }

  /** Asks the server for the pack of the final pick and saves the ZIP. It makes no model call. */
  async function downloadPack() {
    const index = state.finalPickIndex;
    const c = index === null ? undefined : state.concepts[index];
    if (!c || !c.plan) return;
    setPackState({ busy: true, message: null });
    const hex = /#(?:[0-9a-f]{6}|[0-9a-f]{3})/gi;
    const folioColours = ((body.folio as { brand_colours?: string[] } | undefined)?.brand_colours ?? []).filter((x) => typeof x === 'string');
    const brandColours = [...folioColours, ...(String(body.brandColours ?? '').match(hex) ?? [])];
    try {
      const res = await fetch('/api/pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-demo-code': getDemoCode() },
        body: JSON.stringify({
          concept: { round: c.round, archetype: c.archetype, headline: c.headline, body: c.body, cta: c.cta ?? '', plan: c.plan, imageB64: c.imageB64 },
          brief: { briefType, clientName: body.clientName, offer: body.offer, eventDate: body.eventDate, eventPlace: body.eventPlace, brandColours },
          cutoutB64: c.archetype === 'behind' || c.archetype === 'product' ? state.cutoutB64 ?? undefined : undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setPackState({ busy: false, message: payload.error ?? `The pack could not be made (${res.status}).` });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'campaign-pack.zip';
      a.click();
      URL.revokeObjectURL(url);
      setPackState({ busy: false, message: 'Saved campaign-pack.zip' });
    } catch {
      setPackState({ busy: false, message: 'The pack could not be made. Check your connection and try again.' });
    }
  }

  function retry() {
    const last = lastRevisionRef.current;
    if (state.revising && last) {
      dispatch({ kind: 'revise', rev: last.rev });
      void stream(last.request);
    } else {
      onRetry();
    }
  }

  const end = state.end;
  const canRetry = !!end && RETRYABLE.includes(end.reason);
  const retryLabel = state.revising ? 'Retry revision' : state.status === 'error' ? 'Retry' : 'Run again';

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
    <div className="flex min-w-0 flex-col gap-3.5">
      {state.memoryNote && (
        <div role="note" className="rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3 py-2 text-xs text-[var(--cm-text-secondary)]">
          {state.memoryNote}
        </div>
      )}
      <div className="flex flex-wrap gap-5 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4" aria-label="Run progress">
        {hasProduct && (
        <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--cm-bg)]">
          {state.thumbnailB64 ? (
            <img src={`data:image/png;base64,${state.thumbnailB64}`} alt="Your product, cut out" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-[11px] text-[var(--cm-text-muted)]">Cut-out appears here</span>
          )}
        </div>
        )}
        <ol className="m-0 flex min-w-[200px] flex-1 list-none flex-col gap-1.5 p-0 text-[13px]">
          {hasProduct && (
            <li className="flex items-center gap-2 text-[var(--cm-text-primary)]">
              <Dot status={state.cutoutDone ? 'done' : running ? 'active' : 'pending'} /> Isolating your product
            </li>
          )}
          {running && (state.round > 0 || !hasProduct || state.revising) && (
            <>
              <li className="mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]" data-round-heading>
                {state.revising
                  ? `Revision of round ${state.revising.fromRound}, as round ${state.revising.round}`
                  : `Round ${shownRound} of up to ${MAX_ROUNDS}`}
              </li>
              {steps.map((s, i) => (
                <li key={s.key} className={`flex items-center gap-2 ${statuses[i] === 'pending' ? 'text-[var(--cm-text-muted)]' : 'text-[var(--cm-text-primary)]'}`}>
                  <Dot status={statuses[i]} /> {s.label}
                  {(() => {
                    const use = state.models.find((m) => m.round === shownRound && m.step === STEP_MODEL[s.key]);
                    return use ? <span className="ml-1 text-[11px] text-[var(--cm-text-muted)]" data-model-step={STEP_MODEL[s.key]}>{'· ' + modelText(use)}</span> : null;
                  })()}
                </li>
              ))}
            </>
          )}
          {!running && end && active && (
            <li className="mt-1 flex flex-wrap items-center gap-3 text-[13px] font-semibold text-[var(--cm-text-primary)]" role="status" data-run-end={end.reason}>
              <span>{end.message}</span>
              {canRetry && <button type="button" className="btn-ghost" onClick={retry}>{retryLabel}</button>}
            </li>
          )}
        </ol>
      </div>

      {state.status === 'error' && state.error && (
        <div role="alert" className="rounded-lg border border-[var(--cm-border-strong)] bg-[var(--cm-surface)] px-3.5 py-2.5 text-[13px] text-[var(--cm-text-primary)]">
          {state.error}
        </div>
      )}

      {state.status !== 'error' && <WaitGame spriteB64={state.thumbnailB64} />}

      <div ref={resultsRef} className="flex flex-col gap-3.5">
        {state.concepts.map((c, i) => (
          <RoundCard key={c.round} concept={c} isFinal={state.status === 'done' && i === state.finalPickIndex} feedback={saved[c.round]}
            unchanged={c.revisionOf ? revisionOutcome(state.concepts, c).message : null}
            onRevise={!running && saved[c.round] && c.plan ? () => revise(c.round) : undefined} />
        ))}
      </div>

      {/* A product ad whose final pick is a generated scene is not offered a pack: the picture exists at one size only. */}
      {state.status === 'done' && state.finalPickIndex !== null && state.concepts[state.finalPickIndex]?.plan && !(hasProduct && needsScene(state.concepts[state.finalPickIndex].archetype)) && (() => {
        const fin = state.concepts[state.finalPickIndex];
        const sizes = packAvailability(fin.archetype);
        const missing = sizes.filter((s) => !s.available);
        return (
          <div className="rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4" aria-label="Campaign pack">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">Campaign pack</div>
            <p className="m-0 mb-2.5 text-xs leading-relaxed text-[var(--cm-text-secondary)]">
              The final pick (round {fin.round}) at square, story and poster sizes, with its copy, in one ZIP. It makes no model call.
              {missing.length > 0 && ` Story and poster are not in this pack: ${missing[0].reason}.`}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" className="btn-primary" onClick={downloadPack} disabled={packState.busy || (fin.archetype !== 'typographic' && fin.archetype !== 'artwork' && !state.cutoutB64)}>
                {packState.busy ? 'Making the pack…' : 'Download pack'}
              </button>
              {packState.message && <span role="status" className="text-xs text-[var(--cm-text-secondary)]">{packState.message}</span>}
            </div>
          </div>
        );
      })()}

      {state.status === 'done' && !readyDismissed && active && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[1100] flex w-[calc(100%-32px)] max-w-[480px] -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--cm-accent)] bg-[var(--cm-surface-raised)] px-4 py-3 text-[13px] text-[var(--cm-text-primary)]">
          <span className="flex-1 font-semibold">Your ads are ready</span>
          <button className="btn-primary" onClick={() => { resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setReadyDismissed(true); }}>View</button>
          <button className="btn-ghost" onClick={() => setReadyDismissed(true)}>Dismiss</button>
        </div>
      )}
    </div>
    <aside className="min-w-0 lg:sticky lg:top-4">
      <FeedbackPanel concepts={state.concepts} status={state.status} finalPickIndex={state.finalPickIndex} memoryId={winnerId}
        briefType={briefType} hasProduct={hasProduct} ctx={feedbackContext} saved={saved}
        onSaved={(round, fb) => setSaved((prev) => ({ ...prev, [round]: fb }))} />
    </aside>
    </div>
  );
}

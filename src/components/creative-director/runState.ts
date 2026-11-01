// NEW FOR HACKATHON. Client-side mirror of the Creative Director stream (api/run.ts)
// and a pure reducer from NDJSON events to what RunStage shows. No React, unit tested.
import type { CreativeChannel } from '../../lib/meta/brief';
import { describeEnd, pickBest, type StopReason } from '../../lib/meta/runEnd';
import type { PlanCarry } from '../../lib/meta/revision';

export type PartKey = 'legibility' | 'hierarchy' | 'composition' | 'brandFit' | 'fidelity' | 'originality';
export const PART_KEYS: readonly PartKey[] = ['legibility', 'hierarchy', 'composition', 'brandFit', 'fidelity', 'originality'];

export interface ModelUse {
  round: number;
  step: string; // planner, copy, fidelity, folio or critic
  provider: string; // baseten or meta
  label: string; // for example "Muse Spark Open on Baseten"
  fellBack: boolean;
  reason: string | null; // why it fell back, in plain words
}

export const STEP_NAME: Record<string, string> = { planner: 'Planner', copy: 'Copy', fidelity: 'Fidelity check', folio: 'Brand rules', critic: 'Critic' };

/** What the person reads: the model, and when it was a fallback, that it was and why. */
export function modelText(use: Pick<ModelUse, 'label' | 'fellBack' | 'reason'>): string {
  return use.fellBack ? `${use.label} (fallback${use.reason ? `: ${use.reason}` : ''})` : use.label;
}

export interface Breakdown {
  parts: Record<PartKey, { score: number; note: string }>;
  overallBeforeCaps: number;
  capReason: string | null; // for example "Capped at 4: Text in the artwork", when a cap held the score down
}

export interface Concept {
  round: number;
  imageB64: string;
  imageMime: string;
  method: 'one-pass edit' | 'layout composite' | 'typographic' | 'artwork' | 'plain background' | 'type behind product';
  archetype: 'typographic' | 'artwork' | 'product' | 'behind';
  headline: string;
  body: string; // the subline
  direction?: string; // the creative direction this round followed
  plan?: PlanCarry; // what the design was made from, sent back when this round is revised
  revisionOf?: { round: number; note: string; applied?: string[]; ignored?: string[] }; // set when this round revises an earlier one
  style?: { look: string | null; theme: string | null; effect: { id: string; intensity: number; stylise?: boolean } | null; stylised: boolean; effectable?: boolean };
  unreviewed?: string; // set when the picture changed after the critic looked at it (a new effect): why the score is not current
  alternatives?: { headline: string; subline: string; angle: string }[]; // the other ad lines, offered as one-click choices
  edited?: boolean; // the person changed the words: the score is out of date
  manualEffect?: boolean; // the person picked this ad's effect by hand with Try another effect, so a change for all ads leaves it alone
  look?: string; // a hash of the picture, to tell a revision that changed nothing from one that did
  weakness?: string;
  fix?: string;
  cta?: string; // the call to action, its own element
  bullets?: string[];
  models?: ModelUse[]; // which model ran each text or vision step this round
  breakdown?: Breakdown | null;
  paletteSummary?: string;
  critique: string;
  defects: string[]; // hard failures that capped the score at 4
  notes: string[];
  fidelity: { sameProduct: boolean; differences: string[] };
  folioCheck: { passed: boolean; reason: string | null };
  score: number;
}

export type StreamEvent =
  | { type: 'run_started' | 'cutout_started' | 'scene_started' | 'scene_done' | 'composite_done' | 'copy_done' | 'critique_done' }
  | { type: 'cutout_done'; thumbnailB64: string }
  | { type: 'cutout_full'; pngB64: string }
  | { type: 'fallback_note'; message: string }
  | { type: 'memory_used'; label: string; corrections: number; winners: number; note: string }
  | ({ type: 'model_used' } & ModelUse)
  | { type: 'round_started'; round: number }
  | { type: 'fidelity_checked'; sameProduct: boolean; differences: string[] }
  | { type: 'folio_checked'; passed: boolean; reason: string | null }
  | { type: 'round_done'; round: number; score: number; concept: Concept }
  | { type: 'run_finished'; reason: StopReason; rounds: number; bestScore: number; message: string }
  | { type: 'final_picked'; index: number }
  | { type: 'result'; result: { concepts: Concept[]; finalPickIndex: number }; imagesOmitted: boolean; memoryId?: string | null; revision?: boolean }
  | { type: 'error'; message: string };

export const MAX_ROUNDS = 3;

export interface Step {
  key: string;
  label: string;
  doneOn: StreamEvent['type'];
  startOn?: StreamEvent['type'];
}

/** Per-round pipeline steps, in the order the server runs them. */
export function roundSteps(_channel?: CreativeChannel): Step[] {
  return [
    { key: 'copy', label: 'Writing copy', doneOn: 'copy_done' },
    { key: 'scene', label: 'Generating scene', startOn: 'scene_started', doneOn: 'scene_done' },
    { key: 'composite', label: 'Designing layout', doneOn: 'composite_done' },
    { key: 'fidelity', label: 'Checking fidelity', doneOn: 'fidelity_checked' },
    { key: 'folio', label: 'Checking brand rules', doneOn: 'folio_checked' },
    { key: 'critique', label: 'Critiquing', doneOn: 'critique_done' },
  ];
}

export type RunStatus = 'connecting' | 'running' | 'done' | 'error' | 'dropped';

/** Why the run is no longer running, in the sentence the progress box shows. */
export interface RunEnd {
  reason: StopReason;
  message: string;
}

/** A revision in flight or just finished: which round it revises and the note it applies. */
export interface Revising {
  adRound?: number; // the round this ad is on, counted per ad (see adRound in the Catalogue model)
  fromRound: number;
  round: number;
  note: string;
}

export interface RunState {
  status: RunStatus;
  cutoutDone: boolean;
  thumbnailB64: string | null;
  cutoutB64: string | null; // the cut-out at working size, kept for the campaign pack
  notes: string[]; // plain sentences about choices the engine made for this product, such as a layout fallback
  round: number; // 0 until the first round starts
  roundEvents: StreamEvent['type'][]; // events seen in the current round
  concepts: Concept[];
  finalPickIndex: number | null;
  models: ModelUse[]; // every model use reported so far, newest per round and step
  memoryNote: string | null; // what saved feedback and history this run used, when any
  memoryId: string | null; // the saved row for this run's final pick, so my score can be added to it
  error: string | null;
  end: RunEnd | null; // set once the run has stopped, whatever the reason
  revising: Revising | null; // set while a revision is running
}

export const initialRunState: RunState = {
  status: 'connecting',
  cutoutDone: false,
  thumbnailB64: null,
  cutoutB64: null,
  notes: [],
  round: 0,
  roundEvents: [],
  concepts: [],
  finalPickIndex: null,
  models: [],
  memoryNote: null,
  memoryId: null,
  error: null,
  end: null,
  revising: null,
};

/** A revision starts: keep every card, show the run as working again, clear the last ending. */
export function startRevision(state: RunState, rev: Revising): RunState {
  return { ...state, status: 'connecting', error: null, end: null, revising: rev, round: rev.round, roundEvents: [] };
}

// The same rule as the server: score, then legibility, then composition, then a photographic scene, then the later round.
const bestOf = (concepts: Concept[]): number =>
  pickBest(concepts.map((c) => ({ round: c.round, score: c.score, archetype: c.archetype, legibility: c.breakdown?.parts.legibility?.score, composition: c.breakdown?.parts.composition?.score })));

function upsertConcept(concepts: Concept[], concept: Concept): Concept[] {
  const rest = concepts.filter((c) => c.round !== concept.round);
  return [...rest, concept].sort((a, b) => a.round - b.round);
}

export function reduceRun(state: RunState, event: StreamEvent): RunState {
  switch (event.type) {
    case 'run_started':
      return { ...state, status: 'running' };
    case 'cutout_done':
      return { ...state, cutoutDone: true, thumbnailB64: event.thumbnailB64 };
    case 'fallback_note':
      return { ...state, notes: state.notes.includes(event.message) ? state.notes : [...state.notes, event.message] };
    case 'cutout_full':
      return { ...state, cutoutB64: event.pngB64 };
    case 'memory_used':
      return { ...state, memoryNote: event.note };
    case 'model_used': {
      const { type: _type, ...use } = event;
      return { ...state, models: [...state.models.filter((m) => !(m.round === use.round && m.step === use.step)), use] };
    }
    case 'round_started':
      return { ...state, round: event.round, roundEvents: [] };
    case 'round_done':
      return { ...state, roundEvents: [...state.roundEvents, event.type], concepts: upsertConcept(state.concepts, event.concept) };
    case 'run_finished':
      return { ...state, end: { reason: event.reason, message: event.message } };
    case 'final_picked':
      return { ...state, finalPickIndex: event.index };
    case 'result': {
      if (event.revision) {
        // A revision's result holds only the new round: add it to the cards already here.
        const live = new Map(state.concepts.map((c) => [c.round, c.imageB64]));
        const added = event.result.concepts.map((c) => ({ ...c, imageB64: c.imageB64 || live.get(c.round) || '' }));
        const concepts = added.reduce(upsertConcept, state.concepts);
        return { ...state, status: 'done', concepts, finalPickIndex: bestOf(concepts) };
      }
      // Images may be omitted from the result if they were already streamed; keep the live ones.
      const live = new Map(state.concepts.map((c) => [c.round, c.imageB64]));
      const concepts = event.result.concepts.map((c) => ({ ...c, imageB64: c.imageB64 || live.get(c.round) || '' }));
      return { ...state, status: 'done', concepts, finalPickIndex: event.result.finalPickIndex, memoryId: event.memoryId ?? null };
    }
    case 'error':
      return { ...state, status: 'error', error: event.message, end: { reason: 'error', message: describeEnd('error', { rounds: state.concepts.length, bestScore: 0 }) } };
    default:
      return { ...state, roundEvents: [...state.roundEvents, event.type] };
  }
}

/** The stream ended without a result or error line: keep what arrived, mark it dropped. */
export function markStreamEnded(state: RunState): RunState {
  if (state.status === 'done' || state.status === 'error') return state;
  return { ...state, status: 'dropped', end: { reason: 'dropped', message: describeEnd('dropped', { rounds: state.concepts.length, bestScore: 0 }) } };
}

export type StepStatus = 'pending' | 'active' | 'done';

/** Status of each step in the current round. The first step not yet done is the active one. */
export function stepStatuses(steps: Step[], roundEvents: StreamEvent['type'][], running: boolean): StepStatus[] {
  let activeGiven = !running;
  return steps.map((s) => {
    if (roundEvents.includes(s.doneOn)) return 'done';
    if (!activeGiven) {
      activeGiven = true;
      return 'active';
    }
    return 'pending';
  });
}

/** Splits a growing NDJSON buffer into complete parsed lines plus the unfinished remainder. */
export function splitNdjson(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: StreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // A malformed line is skipped rather than ending the run view.
    }
  }
  return { events, rest };
}

/** The number a new revision gets: one after the highest round so far. */
export function nextRound(concepts: ReadonlyArray<{ round: number }>): number {
  return concepts.length ? Math.max(...concepts.map((c) => c.round)) + 1 : 1;
}

/**
 * Makes the given round the one shown as the final pick. After a revision the person is looking at the new ad, so that is the one
 * to show, even when it scored lower than an earlier round (the earlier round stays in the list and can be chosen again).
 */
export function showRound(state: RunState, round: number): RunState {
  const at = state.concepts.findIndex((c) => c.round === round);
  return at < 0 ? state : { ...state, finalPickIndex: at };
}

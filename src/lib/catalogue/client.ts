// Browser calls for Catalogue mode: the photo check, one product's run (or revision) as a stream, and the
// plain messages for a limit. These reuse the same endpoints and the same stream reducer as the single-ad page.
import { initialRunState, markStreamEnded, reduceRun, splitNdjson, startRevision, type Revising, type RunState } from "../../components/creative-director/runState";
import { getDemoCode, memoryForRun } from "../browser/store";
import { isLowResolution, type PhotoCheck, type PhotoFlags } from "./model.js";

export interface LimitStop {
  /** Set when the whole batch should stop: a limit, a wrong demo code, or the demo being off. */
  message: string;
}

const STOP_STATUSES = new Set([401, 429, 503]);

function stopMessage(status: number, serverMessage: string | undefined): string {
  if (status === 429) return `The batch stopped because a limit was reached. ${serverMessage ?? ""}`.trim() + " Products already finished are kept.";
  if (status === 401) return "The batch stopped because the demo code is not right. Check the code at the top right.";
  return "The batch stopped because the demo is switched off.";
}

/** Asks the server to look at one photo. Never throws: a failed check comes back as ran: false. */
export async function checkPhoto(photoDataUrl: string, name: string, signal?: AbortSignal): Promise<{ check: PhotoCheck; stop: LimitStop | null }> {
  const failed = (width = 0, height = 0): PhotoCheck => ({ ran: false, flags: null, width, height, via: null });
  try {
    const res = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-demo-code": getDemoCode() },
      body: JSON.stringify({ photo: photoDataUrl, name }), // the name is only for tracing; the server does not use it
      signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return { check: failed(), stop: STOP_STATUSES.has(res.status) ? { message: stopMessage(res.status, payload.error) } : null };
    const flags: PhotoFlags = { ...payload.flags, low_resolution: isLowResolution(payload.width, payload.height) };
    return { check: { ran: true, flags, width: payload.width, height: payload.height, via: payload.via ?? null }, stop: null };
  } catch {
    return { check: failed(), stop: null };
  }
}

export interface RunOutcome {
  run: RunState;
  stop: LimitStop | null;
}

/** Posts one run request and feeds its stream to the reducer, calling onState after every change. */
export async function streamRun(requestBody: Record<string, unknown>, start: RunState, onState: (s: RunState) => void, signal?: AbortSignal): Promise<RunOutcome> {
  let state = start;
  const apply = (next: RunState) => { state = next; onState(state); };
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-demo-code": getDemoCode() },
      body: JSON.stringify({ ...requestBody, memory: memoryForRun() }),
      signal,
    });
    if (!res.ok || !res.body) {
      const payload = await res.json().catch(() => ({}));
      apply(reduceRun(state, { type: "error", message: payload.error ?? `Request failed (${res.status})` }));
      return { run: state, stop: STOP_STATUSES.has(res.status) ? { message: stopMessage(res.status, payload.error) } : null };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitNdjson(buffer);
      buffer = rest;
      for (const event of events) apply(reduceRun(state, event));
    }
    for (const event of splitNdjson(buffer + "\n").events) apply(reduceRun(state, event));
    apply(markStreamEnded(state));
  } catch (e) {
    if (signal?.aborted) return { run: state, stop: { message: "The batch was stopped." } };
    apply(state.status === "connecting" ? reduceRun(state, { type: "error", message: e instanceof Error ? e.message : String(e) }) : markStreamEnded(state));
  }
  return { run: state, stop: null };
}

export const freshRun = (): RunState => ({ ...initialRunState });
export const reviseRun = (state: RunState, rev: Revising): RunState => startRevision(state, rev);

/** One plain line for what a running product is doing now. */
export function progressLine(run: RunState): string {
  if (run.revising && run.round && run.status === "connecting") return `Revising as round ${run.revising.adRound ?? run.round}`;
  if (run.status === "connecting") return "Starting";
  if (run.revising && run.round) return `Revising as round ${run.revising.adRound ?? run.round}`;
  if (!run.cutoutDone) return "Cutting the product out";
  if (run.round === 0) return "Planning";
  const done = run.roundEvents.includes("critique_done") ? "reviewing done" : "making and reviewing";
  return `Round ${run.round} of 2, ${done}`;
}

/** Saves bytes as a file in the browser. */
export function saveFile(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface EffectOutcome {
  imageB64: string;
  imageMime: string;
  effect: { id: string; intensity: number; stylise?: boolean } | null;
  checks: string[];
}

/** Draws one ad again with another effect. No model call. Returns an error sentence when a safeguard refuses it. */
export async function tryEffect(body: Record<string, unknown>): Promise<{ ok: true; out: EffectOutcome } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/effect", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-code": getDemoCode() }, body: JSON.stringify(body) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: payload.error ?? `The effect could not be applied (${res.status}).` };
    return { ok: true, out: payload as EffectOutcome };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The effect could not be applied." };
  }
}

export interface FoundItemsOutcome {
  ok: boolean;
  items: Array<{ name: string; ok: boolean; reason: string | null; photo: string | null }>;
  error: string | null;
}

/** Asks the server to find the separate products in one photo and cut each out on its own. Started only by a click. */
export async function findItemsInPhoto(photoDataUrl: string): Promise<FoundItemsOutcome> {
  try {
    const res = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-code": getDemoCode() }, body: JSON.stringify({ photo: photoDataUrl }) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, items: [], error: payload.error ?? `The items could not be found (${res.status}).` };
    return { ok: true, items: Array.isArray(payload.items) ? payload.items : [], error: null };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : "The items could not be found." };
  }
}

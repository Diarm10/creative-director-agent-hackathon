// NEW FOR HACKATHON. The provider layer for the text and vision steps.
//
// Muse Spark Open on Baseten and Muse Spark on Meta's Model API sit behind one small interface.
// Each step (planner, copy, fidelity, folio, critic) has its own provider setting. The default is
// Baseten for every step when BASETEN_API_KEY is set, and Meta otherwise. Every Baseten call has a
// timeout and falls back to Meta on an error, a timeout, a rate limit, an empty reply or (for steps
// that expect JSON) a reply that cannot be parsed, so Baseten can never fail a run. Muse Image and
// SAM are not routed here: they stay on Meta's API.
//
// The key is read from the environment only, held inside the Baseten backend, and never logged,
// returned, or put in an error message.
import OpenAI from "openai";
import { MODELS, meta, text as metaText } from "./client.js";
import { safeJson, stripReasoning } from "./creativeDirectorPure.js";

export type StepName = "planner" | "copy" | "fidelity" | "folio" | "critic";
export const STEPS: readonly StepName[] = ["planner", "copy", "fidelity", "folio", "critic"];
export type ProviderName = "baseten" | "meta";

export const BASETEN_BASE_URL = "https://inference.baseten.co/v1";
// The id from the hackathon page, not the one in Baseten's public docs.
export const BASETEN_MODEL_DEFAULT = "meta-models/muse-spark-open-1026";

/**
 * The provider each step uses when a Baseten key is set. scripts/compare-providers.ts measured both
 * providers on the same jobs (see HACKATHON.md): the critic and the fidelity check were as good on
 * Baseten, but the planner was worse at writing its own headline (twice naming the product instead of
 * saying why the audience should care, against an explicit rule) and chose a less neutral call to
 * action, so the planner is set back to Meta. The copy and folio steps were not exercised by the
 * comparison and keep the starting setting. Any step can still be pointed either way with
 * STEP_PROVIDER_<STEP>.
 */
export const DEFAULT_PROVIDER_WHEN_KEYED: Record<StepName, ProviderName> = {
  planner: "meta",
  copy: "baseten",
  fidelity: "baseten",
  folio: "baseten",
  critic: "baseten",
};

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_VISION_TIMEOUT_MS = 45_000;
// After this many Baseten failures in one run, the rest of the run goes straight to Meta, so a slow
// or down provider cannot eat the run's time budget one timeout at a time.
const DEFAULT_BREAKER_LIMIT = 2;

export type Env = Record<string, string | undefined>;

export interface ProviderConfig {
  hasBasetenKey: boolean; // whether a key is set; the key itself is never stored in the config
  basetenModel: string;
  basetenBaseUrl: string;
  steps: Record<StepName, ProviderName>;
  timeoutMs: number;
  visionTimeoutMs: number;
}

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1000 ? Math.round(n) : fallback;
};

/**
 * Reads the settings from the environment. STEP_PROVIDER_PLANNER, _COPY, _FIDELITY, _FOLIO and _CRITIC
 * ("baseten" or "meta") override a single step. BASETEN_MODEL, BASETEN_BASE_URL, BASETEN_TIMEOUT_MS and
 * BASETEN_VISION_TIMEOUT_MS tune the Baseten side.
 */
export function loadProviderConfig(env: Env = process.env): ProviderConfig {
  const hasKey = !!env.BASETEN_API_KEY?.trim();
  const steps = {} as Record<StepName, ProviderName>;
  for (const step of STEPS) {
    const override = env[`STEP_PROVIDER_${step.toUpperCase()}`]?.trim().toLowerCase();
    steps[step] = override === "baseten" || override === "meta" ? override : hasKey ? DEFAULT_PROVIDER_WHEN_KEYED[step] : "meta";
  }
  return {
    hasBasetenKey: hasKey,
    basetenModel: env.BASETEN_MODEL?.trim() || BASETEN_MODEL_DEFAULT,
    basetenBaseUrl: env.BASETEN_BASE_URL?.trim() || BASETEN_BASE_URL,
    steps,
    timeoutMs: positiveInt(env.BASETEN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    visionTimeoutMs: positiveInt(env.BASETEN_VISION_TIMEOUT_MS, DEFAULT_VISION_TIMEOUT_MS),
  };
}

/** What the person sees, for example "Muse Spark Open on Baseten". */
export function modelLabel(provider: ProviderName, model: string): string {
  if (provider === "baseten") return /muse-spark-open/i.test(model) ? "Muse Spark Open on Baseten" : `${model} on Baseten`;
  const v = model.match(/muse-spark-(\d[\d.]*)/i);
  return v ? `Muse Spark ${v[1]} on Meta` : `${model} on Meta`;
}

export interface StepCall {
  step: StepName;
  input: string;
  instructions?: string;
  images?: string[]; // image data URLs, for the vision steps
  temperature?: number;
  expectJson?: boolean; // a reply that is not parseable JSON counts as a failure and falls back
}

export interface Backend {
  provider: ProviderName;
  model: string;
  run(call: StepCall, signal?: AbortSignal): Promise<string>;
}

export interface StepRecord {
  step: StepName;
  wanted: ProviderName; // what the settings asked for
  provider: ProviderName; // what actually answered
  model: string;
  label: string;
  fellBack: boolean;
  reason: string | null; // why it fell back, in plain words
  ms: number;
}

/** Whether Muse Spark on Meta accepted a temperature on a vision call: null until the first one. */
export const temperatureStatus: { accepted: boolean | null } = { accepted: null };

// ---- Meta backend --------------------------------------------------------------------------

type VisionContent = Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "auto" | "high" }>;

/** Meta's Model API: client.ts text() for text, the Responses API for vision. Temperature 0 is retried without if refused. */
export function createMetaBackend(): Backend {
  return {
    provider: "meta",
    model: MODELS.text,
    async run(call) {
      if (!call.images?.length) {
        return metaText(call.input, call.instructions, call.temperature !== undefined ? { temperature: call.temperature } : {});
      }
      const content: VisionContent = [
        { type: "input_text", text: call.input },
        ...call.images.map((url) => ({ type: "input_image" as const, image_url: url, detail: "auto" as const })),
      ];
      const input = [{ type: "message" as const, role: "user" as const, content }];
      try {
        const r = await meta.responses.create({ model: MODELS.text, input, ...(call.temperature !== undefined ? { temperature: call.temperature } : {}) });
        if (call.temperature !== undefined) temperatureStatus.accepted = true;
        return r.output_text;
      } catch (e) {
        if (call.temperature !== undefined && (e as { status?: number })?.status === 400) {
          temperatureStatus.accepted = false;
          const r = await meta.responses.create({ model: MODELS.text, input });
          return r.output_text;
        }
        throw e;
      }
    },
  };
}

// ---- Baseten backend -----------------------------------------------------------------------

/** The part of an OpenAI-compatible client this layer uses, so tests can pass a fake. */
export interface ChatClient {
  chat: {
    completions: {
      create(
        body: { model: string; messages: unknown[]; temperature?: number },
        opts?: { signal?: AbortSignal },
      ): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
}

export type ChatClientFactory = (opts: { baseURL: string; apiKey: string; maxRetries: number }) => ChatClient;

const defaultFactory: ChatClientFactory = (opts) => new OpenAI(opts) as unknown as ChatClient;

/**
 * Muse Spark Open on Baseten, through its OpenAI-compatible chat endpoint. Returns null when there is no
 * key. The key lives only inside this closure.
 */
export function createBasetenBackend(config: ProviderConfig, env: Env = process.env, factory: ChatClientFactory = defaultFactory): Backend | null {
  const apiKey = env.BASETEN_API_KEY?.trim();
  if (!apiKey) return null;
  // One SDK retry at most: a slow provider must not stall the run, the router falls back instead.
  const client = factory({ baseURL: config.basetenBaseUrl, apiKey, maxRetries: 1 });
  return {
    provider: "baseten",
    model: config.basetenModel,
    async run(call, signal) {
      const user = call.images?.length
        ? [{ type: "text", text: call.input }, ...call.images.map((url) => ({ type: "image_url", image_url: { url } }))]
        : call.input;
      const messages = [...(call.instructions ? [{ role: "system", content: call.instructions }] : []), { role: "user", content: user }];
      const send = (withTemperature: boolean) =>
        client.chat.completions.create(
          { model: config.basetenModel, messages, ...(withTemperature && call.temperature !== undefined ? { temperature: call.temperature } : {}) },
          { signal },
        );
      try {
        const r = await send(true);
        return r.choices[0]?.message?.content ?? "";
      } catch (e) {
        // The same courtesy the Meta side has: if a temperature is refused, ask once without it.
        if (call.temperature !== undefined && (e as { status?: number })?.status === 400) {
          const r = await send(false);
          return r.choices[0]?.message?.content ?? "";
        }
        throw e;
      }
    },
  };
}

// ---- Call budget (used by the comparison script) -------------------------------------------

export class BudgetExceededError extends Error {
  readonly max: number;
  constructor(max: number) {
    super(`Model call budget of ${max} reached`);
    this.max = max;
  }
}

/** A hard cap on model calls. take() throws once the cap is spent; nothing downstream swallows it. */
export class CallBudget {
  used = 0;
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  take(): void {
    if (this.used >= this.max) throw new BudgetExceededError(this.max);
    this.used += 1;
  }
}

// ---- Router --------------------------------------------------------------------------------

export interface RouterOptions {
  config: ProviderConfig;
  baseten: Backend | null;
  meta: Backend;
  budget?: CallBudget;
  breakerLimit?: number;
  now?: () => number;
}

export interface Router {
  run(call: StepCall): Promise<{ text: string; record: StepRecord }>;
}

class TimeoutError extends Error {}

function describeFailure(e: unknown): string {
  if (e instanceof TimeoutError || (e as { name?: string })?.name === "AbortError") return "timed out";
  const status = (e as { status?: number })?.status;
  if (status === 429) return "rate limited";
  if (status === 401 || status === 403) return "rejected by Baseten";
  if (typeof status === "number" && status >= 500) return `Baseten error ${status}`;
  return "Baseten error";
}

async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError("timed out"));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sends each step to its configured provider and falls back to Meta on any Baseten problem. The result
 * always says which model answered and whether that was a fallback. A run-level breaker skips Baseten
 * after a couple of failures. Only a Meta failure, or the call budget, can make run() throw.
 */
export function createRouter(opts: RouterOptions): Router {
  const now = opts.now ?? Date.now;
  const limit = opts.breakerLimit ?? DEFAULT_BREAKER_LIMIT;
  let failures = 0;

  return {
    async run(call) {
      const started = now();
      const wanted = opts.config.steps[call.step];
      const make = (backend: Backend, fellBack: boolean, reason: string | null, text: string) => ({
        text,
        record: {
          step: call.step, wanted, provider: backend.provider, model: backend.model, label: modelLabel(backend.provider, backend.model),
          fellBack, reason, ms: now() - started,
        } satisfies StepRecord,
      });

      let reason: string | null = null;
      if (wanted === "baseten") {
        if (!opts.baseten) reason = "no Baseten key set";
        else if (failures >= limit) reason = "skipped after earlier Baseten failures in this run";
        else {
          const timeoutMs = call.images?.length ? opts.config.visionTimeoutMs : opts.config.timeoutMs;
          try {
            opts.budget?.take();
            const raw = await withTimeout(timeoutMs, (signal) => opts.baseten!.run(call, signal));
            const text = stripReasoning(raw);
            if (!text) throw Object.assign(new Error("empty"), { kind: "empty reply" });
            if (call.expectJson && safeJson(text) === null) throw Object.assign(new Error("unparseable"), { kind: "unparseable reply" });
            return make(opts.baseten, false, null, text);
          } catch (e) {
            if (e instanceof BudgetExceededError) throw e;
            // One timeout means Baseten is slow right now: waiting for it again and again would stall the run, so it counts as the limit.
            const slow = e instanceof TimeoutError || (e as { name?: string })?.name === "AbortError";
            failures += slow ? limit : 1;
            reason = (e as { kind?: string })?.kind ?? describeFailure(e);
          }
        }
      }

      opts.budget?.take();
      const text = await opts.meta.run(call);
      return make(opts.meta, wanted === "baseten", reason, text);
    },
  };
}

/** The router for this process: settings from the environment, Baseten only when a key is set. */
export function createRouterFromEnv(env: Env = process.env, extra: { budget?: CallBudget; factory?: ChatClientFactory } = {}): Router {
  const config = loadProviderConfig(env);
  return createRouter({ config, baseten: createBasetenBackend(config, env, extra.factory), meta: createMetaBackend(), budget: extra.budget });
}

// ---- Per-run caller used by the loop -------------------------------------------------------

export interface ModelUse {
  round: number;
  step: StepName;
  provider: ProviderName;
  model: string;
  label: string;
  fellBack: boolean;
  reason: string | null;
}

export interface ModelCaller {
  startRound(round: number): void;
  /** The models used since startRound, one entry per step (the last call for a step wins). */
  endRound(): ModelUse[];
  text(step: StepName, input: string, instructions?: string, opts?: { temperature?: number; expectJson?: boolean }): Promise<string>;
  vision(step: StepName, input: string, images: string[], opts?: { temperature?: number; expectJson?: boolean }): Promise<string>;
}

/** Binds a router to one run: tags each call with the round and reports which model answered. */
export function createModelCaller(router: Router, onUse: (use: ModelUse) => void): ModelCaller {
  let round = 0;
  let uses: ModelUse[] = [];
  const note = (record: StepRecord) => {
    const use: ModelUse = { round, step: record.step, provider: record.provider, model: record.model, label: record.label, fellBack: record.fellBack, reason: record.reason };
    uses = [...uses.filter((u) => u.step !== use.step), use];
    onUse(use);
  };
  return {
    startRound(r) {
      round = r;
      uses = [];
    },
    endRound() {
      return uses;
    },
    async text(step, input, instructions, opts = {}) {
      const { text, record } = await router.run({ step, input, instructions, temperature: opts.temperature, expectJson: opts.expectJson });
      note(record);
      return text;
    },
    async vision(step, input, images, opts = {}) {
      const { text, record } = await router.run({ step, input, images, temperature: opts.temperature, expectJson: opts.expectJson });
      note(record);
      return text;
    },
  };
}

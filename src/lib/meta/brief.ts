// Types shared by the engine, the API route, the MCP server and (as a mirror) the page.
import type { ModelUse } from "./providers.js";
import type { MemoryContext } from "./memory.js";
import type { CriticParts, BriefType, FolioGuardrails } from "./creativeDirectorPure.js";
import type { PlanCarry } from "./revision.js";
import type { StopReason } from "./runEnd.js";
import type { LayoutMetrics } from "./design/layouts.js";
import type { EffectSpec } from "./design/effects.js";

export type { BriefType };
export type CreativeChannel = "paid_social_square" | "story_vertical" | "in_store_poster";
export const CHANNELS: readonly CreativeChannel[] = ["paid_social_square", "story_vertical", "in_store_poster"];

export interface FolioInput extends FolioGuardrails {
  brandColours: readonly string[];
}

export interface Brief {
  briefType?: BriefType; // defaults to "product"
  clientName: string; // the brand, organiser or client
  title?: string; // event or promo name, for example "Build for Your World"
  productNoun?: string; // product briefs: short noun phrase SAM can find
  productImageUrl?: string; // product briefs: the real photo, as a data URL
  offer?: string; // supplied by the person, so approved for this run
  audience: string;
  eventDate?: string;
  eventPlace?: string;
  cta?: string; // call to action, used exactly as written
  facts?: string;
  brandColours?: string; // free text; any hex codes in it become the palette
  channel?: CreativeChannel; // defaults to paid_social_square
  folio?: FolioInput;
  memory?: MemoryContext | null; // client memory, already cleaned and size capped
  maxRounds?: number; // internal: fewer rounds than the usual three, for cheap checks
  rescue?: boolean; // "Try anyway": a held-back photo is cut out by name; if the cut-out fails its check the photo stays held back (no whole-photo fallback)
  copyAvoid?: string[]; // openings other ads in the same batch already use (cleaned words), kept out of the headline
  copyIndex?: number; // the product's place in its batch, so neighbours lead with different angles
  look?: string; // a Look id (looks.ts): how the ad is made
  theme?: string; // a Theme id (themes.ts): the occasion
  effect?: EffectSpec | null; // an effect for the background; undefined is the Look's own default, null is none
}

export interface Fidelity {
  sameProduct: boolean;
  differences: string[];
}

export interface FolioCheck {
  passed: boolean;
  reason: string | null;
}

export interface ConceptBreakdown {
  parts: CriticParts; // six scores from 1 to 10, each with one short sentence
  overallBeforeCaps: number; // the mean of the six parts
  capReason: string | null; // set when a cap held the overall score down
}

export type ConceptMethod = "one-pass edit" | "layout composite" | "typographic" | "artwork" | "type behind product";

export interface MeasuredScore {
  delta: number; // what the measured part added to the critic's score
  faults: string[]; // plain words: each measured fault
  goods: string[];
}

export interface Concept {
  round: number;
  imageB64: string; // always JPEG, to keep the streamed response small
  imageMime: "image/jpeg";
  method: ConceptMethod;
  archetype: "typographic" | "artwork" | "product" | "behind";
  measured?: MeasuredScore; // the measured part of the score
  headline: string;
  body: string; // the subline
  cta: string; // the call to action, its own element
  direction?: string; // the creative direction this round was asked to follow, shown on the card
  plan?: PlanCarry; // what the design was made from, sent back when this round is revised
  revisionOf?: { round: number; note: string; applied: string[]; ignored: string[] }; // set when this round revises an earlier one: what the note changed, and what it asked for that could not be done
  style?: { look: string | null; theme: string | null; effect: EffectSpec | null; stylised: boolean; effectable: boolean }; // what styled this ad, for the card and for Try another effect
  alternatives?: { headline: string; subline: string; angle: string }[]; // the other ad lines the copy engine wrote, for "Show other lines"
  look?: string; // a 256 bit hash of the picture, so a revision that changed nothing can be told from one that did
  layout?: LayoutMetrics; // how the type and the product were composed, in pixels
  weakness?: string; // the critic's weakest point, kept apart from the critique text
  fix?: string;
  models: ModelUse[]; // which model ran each text or vision step this round
  breakdown: ConceptBreakdown | null;
  paletteSummary: string;
  critique: string;
  defects: string[]; // hard failures that capped the score at 4
  notes: string[]; // softer problems
  fidelity: Fidelity;
  folioCheck: FolioCheck;
  score: number; // 1 to 10, capped by the vision, fidelity and folio checks
}

export interface CreativeResult {
  concepts: Concept[];
  finalPickIndex: number; // highest scoring round; ties go to the later round
}

export type CreativeDirectorEvent =
  | { type: "run_started" }
  | { type: "memory_used"; label: string; corrections: number; winners: number; note: string }
  | { type: "model_used"; round: number; step: string; provider: string; label: string; fellBack: boolean; reason: string | null }
  | { type: "cutout_started" }
  | { type: "cutout_done"; thumbnailB64: string }
  | { type: "fallback_note"; message: string } // a plain sentence about a choice the engine made for this product
  | { type: "cutout_full"; pngB64: string } // the cut-out at working size, so the page can ask for a campaign pack without another model call
  | { type: "round_started"; round: number }
  | { type: "copy_done" }
  | { type: "scene_started" }
  | { type: "scene_done"; skipped?: boolean }
  | { type: "composite_done" }
  | { type: "fidelity_checked"; sameProduct: boolean; differences: string[]; skipped?: boolean }
  | { type: "folio_checked"; passed: boolean; reason: string | null }
  | { type: "critique_done" }
  | { type: "round_done"; round: number; score: number; concept: Concept }
  | { type: "run_finished"; reason: StopReason; rounds: number; bestScore: number; message: string }
  | { type: "final_picked"; index: number }
  | { type: "error"; message: string };

export type EventSink = (event: CreativeDirectorEvent) => void;

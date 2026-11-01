// Everything this app remembers lives in this browser's storage: the folios you make, the feedback you save,
// and the winners of past runs ("client memory"). It is sent with each run, so no database or account is
// needed. Storage can be empty, full or blocked, so every read and write is wrapped and falls back to nothing.
import type { FeedbackRow, MemoryRow } from "../meta/memory.js";
import type { FeedbackExportRow } from "../meta/feedbackExport.js";
import type { Folio } from "../meta/folio.js";

const KEY = { folios: "cda.folios", feedback: "cda.feedback", winners: "cda.winners", code: "cda.code" } as const;
const MAX_FEEDBACK = 200;
const MAX_WINNERS = 60;

export type StoredFeedback = FeedbackRow & FeedbackExportRow & { id: string };
export type StoredWinner = MemoryRow & { id: string };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ---- folios you made --------------------------------------------------------------------------

export const loadUserFolios = (): Folio[] => read<Folio[]>(KEY.folios, []).filter((f) => f && typeof f.id === "string");

export function saveUserFolio(folio: Omit<Folio, "id"> & { id?: string }): Folio {
  const all = loadUserFolios();
  const saved: Folio = { ...folio, id: folio.id ?? `mine-${newId()}` };
  write(KEY.folios, [...all.filter((f) => f.id !== saved.id), saved]);
  return saved;
}

export const deleteUserFolio = (id: string): void => void write(KEY.folios, loadUserFolios().filter((f) => f.id !== id));

// ---- feedback ---------------------------------------------------------------------------------

export const listFeedback = (): StoredFeedback[] => read<StoredFeedback[]>(KEY.feedback, []);

export function addFeedback(row: Omit<StoredFeedback, "id">): string {
  const id = `fb-${newId()}`;
  write(KEY.feedback, [...listFeedback(), { ...row, id }].slice(-MAX_FEEDBACK));
  return id;
}

export function updateFeedback(id: string, row: Omit<StoredFeedback, "id">): void {
  write(KEY.feedback, listFeedback().map((f) => (f.id === id ? { ...row, id } : f)));
}

// ---- winners ----------------------------------------------------------------------------------

export const listWinners = (): StoredWinner[] => read<StoredWinner[]>(KEY.winners, []);

export function addWinner(row: MemoryRow): string {
  const id = `win-${newId()}`;
  write(KEY.winners, [...listWinners(), { ...row, id }].slice(-MAX_WINNERS));
  return id;
}

export function setWinnerHumanScore(id: string, score: number): void {
  write(KEY.winners, listWinners().map((w) => (w.id === id ? { ...w, human_score: score } : w)));
}

/** What goes with each run: the saved rows, newest last. The server cleans and caps them again. */
export function memoryForRun(): { feedback: FeedbackRow[]; winners: MemoryRow[] } {
  return { feedback: listFeedback().slice(-60), winners: listWinners().slice(-60) };
}

// ---- demo code --------------------------------------------------------------------------------

export function getDemoCode(): string {
  try {
    return sessionStorage.getItem(KEY.code) ?? "";
  } catch {
    return "";
  }
}

export function setDemoCode(code: string): void {
  try {
    sessionStorage.setItem(KEY.code, code);
  } catch {
    /* the code is just asked for again */
  }
}

// ---- campaigns (Look, Theme and Effect choices) -------------------------------------------------
// Saved only in this browser. Never sent anywhere except as the three choices on a run request.

import { cleanCampaign, type Campaign } from "../catalogue/campaign.js";

const CAMPAIGNS_KEY = "cda.campaigns";
const MAX_CAMPAIGNS = 40;

export function listCampaigns(): Record<string, Campaign> {
  const raw = read<Record<string, unknown>>(CAMPAIGNS_KEY, {});
  const out: Record<string, Campaign> = {};
  for (const [name, v] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const c = cleanCampaign(v);
    if (c) out[name] = c;
  }
  return out;
}

/** Saves one campaign under a name. False when the name is empty or the browser would not store it. */
export function saveCampaign(name: string, campaign: Campaign): boolean {
  const clean = name.trim().slice(0, 60);
  if (!clean) return false;
  const all = listCampaigns();
  const entries = Object.entries({ ...all, [clean]: campaign }).slice(-MAX_CAMPAIGNS);
  return write(CAMPAIGNS_KEY, Object.fromEntries(entries));
}

export function deleteCampaign(name: string): void {
  const all = listCampaigns();
  delete all[name];
  write(CAMPAIGNS_KEY, all);
}

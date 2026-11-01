// Rescue for held-back photos, and finding several items in one photo. Pure and browser safe: the decisions and the parsing live here, the
// model calls are made by the API routes. Nothing here runs by itself: both are started only when a person clicks.
//
// Safeguards that never switch off: a photo with a person or hand, a visible brand or logo, or a watermark is refused, by the page and again by the
// server, whatever the rescue is for.
import { safeJson } from "./creativeDirectorPure.js";
import { PHOTO_CHECK_PROMPT, PHOTO_CHECK_SYSTEM, parsePhotoCheck, type PhotoAnswers } from "./photoCheck.js";

export const MAX_ITEMS = 4; // items found in one photo
export const MAX_ROWS = 12; // the catalogue never holds more rows than this

/** What the card says when the cut-out does not pass its check: the photo stays held back. */
export const RESCUE_NOT_SEPARATED = "The product could not be separated cleanly from this photo, so it stays held back.";

/** The three things a rescue never goes past. */
export const REFUSED_FLAGS = ["person_or_hand", "visible_brand_or_logo", "watermark"] as const;

const REFUSED_WORDS: Record<(typeof REFUSED_FLAGS)[number], string> = {
  person_or_hand: "a person or a hand is in the photo",
  visible_brand_or_logo: "a brand name or logo is visible",
  watermark: "the photo has a watermark",
};

export interface RescueCheck {
  ran: boolean;
  flags: { person_or_hand?: boolean; visible_brand_or_logo?: boolean; watermark?: boolean } | null;
}

export interface Decision {
  ok: boolean;
  reason: string | null; // one plain sentence when not ok
}

/**
 * Whether "Try anyway" and "Find items" may be offered for a photo. They are refused when the check did not run (nobody has looked for a
 * person or a logo) or when it found a person, a brand or a watermark. A busy background, several products or a small photo can be tried.
 */
export function rescueDecision(check: RescueCheck | null, productName: string): Decision {
  if (!productName.trim() || productName.trim().toLowerCase() === "to be added") return { ok: false, reason: "Type the product name first: the cut-out looks for it by name." };
  if (!check || !check.ran || !check.flags) return { ok: false, reason: "The photo check did not run, so nobody has looked for a person or a brand in it. It stays held back." };
  for (const f of REFUSED_FLAGS) if (check.flags[f]) return { ok: false, reason: `This photo is refused for good: ${REFUSED_WORDS[f]}.` };
  return { ok: true, reason: null };
}

/** The server's own look at the photo before a rescue, from the same yes or no questions. Anything it cannot read is a refusal. */
export async function verifyRescue(ask: (prompt: string, system: string) => Promise<string>): Promise<Decision> {
  let answers: PhotoAnswers | null = null;
  try {
    answers = parsePhotoCheck(await ask(PHOTO_CHECK_PROMPT, PHOTO_CHECK_SYSTEM));
  } catch {
    answers = null;
  }
  if (!answers) return { ok: false, reason: "The photo could not be checked for people and brands, so it stays held back." };
  for (const f of REFUSED_FLAGS) if (answers[f]) return { ok: false, reason: `This photo is refused for good: ${REFUSED_WORDS[f]}.` };
  return { ok: true, reason: null };
}

// ---- items in one photo -----------------------------------------------------------------------

export const ITEMS_PROMPT =
  `This photo shows a collection of things for a shop. List the separate products you can see, at most ${MAX_ITEMS}, the most prominent first. ` +
  "Give each a short plain name of 1 to 3 words in the singular, such as dropper bottle or drinking glass. " +
  "Do not list people, hands, body parts, brand names, logos, text, fabric, the table or the background. If the photo shows only one product, list that one. " +
  'Reply only as JSON: {"items":[{"name":"..."}]}';

const NOT_AN_ITEM = /\b(person|people|man|woman|child|hand|hands|finger|fingers|face|logo|brand|text|label|watermark|background|table|fabric|cloth|pattern|shadow|surface|floor|wall)\b/i;

/** The item names from the model's reply: at most four, plain, each different, and never a person, a brand or a background. */
export function parseItems(raw: string): string[] {
  const j = safeJson<{ items?: unknown }>(raw);
  const list = Array.isArray(j?.items) ? j.items : [];
  const out: string[] = [];
  for (const it of list) {
    const name = typeof it === "string" ? it : typeof (it as { name?: unknown })?.name === "string" ? (it as { name: string }).name : "";
    const clean = name.replace(/[–—]/g, " ").replace(/[^a-zA-Z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);
    if (!clean || clean.split(" ").length > 4 || NOT_AN_ITEM.test(clean)) continue;
    if (out.some((o) => o === clean || o.includes(clean) || clean.includes(o))) continue;
    out.push(clean);
    if (out.length === MAX_ITEMS) break;
  }
  return out;
}

export interface FoundItem {
  name: string;
  ok: boolean; // the item was cut out on its own and passed the cut-out check
  reason: string | null; // plain words when not
  photo: string | null; // a data URL of the photo cropped round the item, when ok
}

export interface RowPlan {
  add: FoundItem[]; // items that become rows
  couldNotSeparate: FoundItem[];
  noRoom: FoundItem[]; // separated, but the catalogue is full
}

/** The label a derived row shows: "<item> (from <file>)". */
export const itemLabel = (item: string, file: string): string => `${item} (from ${file})`;

/**
 * Which found items become catalogue rows. The photo they came from is a held-back row with no ad, so it is replaced by its items. The
 * total never goes over 12 rows; items that do not fit are said so, not dropped silently.
 */
export function planItemRows(found: readonly FoundItem[], rowsNow: number): RowPlan {
  const room = Math.max(0, MAX_ROWS - (rowsNow - 1));
  const ok = found.filter((f) => f.ok);
  return { add: ok.slice(0, room), couldNotSeparate: found.filter((f) => !f.ok), noRoom: ok.slice(room) };
}

/** The plain sentences the page shows after "Find items in this photo". */
export function itemsSummary(file: string, plan: RowPlan, total: number): string {
  const parts: string[] = [];
  if (plan.add.length) parts.push(`Found ${total} item${total === 1 ? "" : "s"} in ${file}; ${plan.add.length} became ${plan.add.length === 1 ? "a row" : "rows"}: ${plan.add.map((a) => a.name).join(", ")}`);
  else parts.push(`No item in ${file} could be turned into a row`);
  if (plan.couldNotSeparate.length) parts.push(`Could not separate: ${plan.couldNotSeparate.map((c) => `${c.name} (${c.reason ?? "the cut-out did not pass the check"})`).join("; ")}`);
  if (plan.noRoom.length) parts.push(`No room for ${plan.noRoom.map((n) => n.name).join(", ")}: a catalogue holds at most ${MAX_ROWS} rows`);
  return `${parts.join(". ")}.`;
}

export const ITEMS_NOTE = "This is for a collection style catalogue: one photo of several things becomes one row for each thing, so each can get its own ad.";

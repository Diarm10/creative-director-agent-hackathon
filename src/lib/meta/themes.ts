// Themes: the occasion. Thirteen presets that set a seasonal palette, a mood, a copy angle and the call to action wording.
//
// Hard rules, enforced in code and not left to the model:
//   - a discount, price or promo code is typed in by the person. A sale theme refuses to run without an offer, and the words
//     of the ad may only contain a percentage, an amount, a date or a code that is in the offer the person typed
//   - no claim of delivery by a date, no "limited stock", no scarcity of any kind
//   - the seasonal feel is palette, layout and copy. The image model is never asked for snow, baubles or any scene
// Pure and browser safe.

export type ThemeId = "christmas" | "blackfriday" | "autumn" | "evergreen" | "halloween" | "dayofthedead" | "valentines" | "newyear" | "spring" | "easter" | "mothersday" | "summer" | "backtoschool";

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  swatch: readonly [string, string, string];
  palette: readonly string[] | null; // seasonal colours that replace the Look's, or null for none
  mood: string; // the feel of the occasion in a few words. It steers the copy and the colours only: it is never sent to the image model
  angle: string; // the copy angle, as a sentence for the planner
  cta: string; // the call to action, when the person gave none
  needsOffer: boolean; // a sale theme: it will not run without an offer the person typed
  note?: string; // one short line shown under the description
}

const THEMES_AS_WRITTEN: readonly Theme[] = [
  {
    id: "christmas",
    name: "Christmas",
    description: "Deep green, warm cream, red and gold, with gift-giving wording. No snow or baubles are added to the product.",
    swatch: ["#0F3D2E", "#C4161C", "#D4AF37"],
    palette: ["#0F3D2E", "#F7F1E3", "#C4161C", "#D4AF37"],
    mood: "warm, cosy, generous",
    angle: "Christmas gifting: write as if the product is a gift to give, in warm plain words. Never write Give This or Gift This followed by the product. Never mention a delivery date, a deadline, a price or stock.",
    cta: "Shop gifts",
    needsOffer: false,
  },
  {
    id: "blackfriday",
    name: "Black Friday",
    description: "Black with a sharp yellow and red. Needs an offer you type in, and uses only that offer.",
    swatch: ["#0A0A0A", "#FFD400", "#FF3B30"],
    palette: ["#0A0A0A", "#F5F5F5", "#FFD400", "#FF3B30"],
    mood: "sharp, direct, bold",
    angle: "Black Friday: direct and confident, built on the offer exactly as typed. Never mention stock, urgency or a delivery date.",
    cta: "Shop the sale",
    needsOffer: true,
  },
  {
    id: "autumn",
    name: "Autumn Sale",
    description: "Burnt orange, ochre and cream. Needs an offer you type in, and uses only that offer.",
    swatch: ["#3B2314", "#C8641E", "#E0A030"],
    palette: ["#3B2314", "#FBF1E0", "#C8641E", "#E0A030"],
    mood: "warm, cosy, golden",
    angle: "Autumn: warm and cosy, built on the offer exactly as typed. Never mention stock, urgency or a delivery date.",
    cta: "Shop autumn",
    needsOffer: true,
  },
  {
    id: "evergreen",
    name: "Evergreen",
    description: "No occasion: the Look's own colours and plain wording.",
    swatch: ["#E8E8E8", "#222222", "#888888"],
    palette: null,
    mood: "plain, calm",
    angle: "",
    cta: "Shop now",
    needsOffer: false,
  },
  {
    id: "halloween",
    name: "Halloween",
    description: "Deep plum with pumpkin orange and purple. Playful and a little mischievous, never gory. No props are added to the product.",
    swatch: ["#1B1022", "#FF7A00", "#7B3FA0"],
    palette: ["#1B1022", "#FFF1E0", "#FF7A00", "#7B3FA0"],
    mood: "playful, mischievous, cosy-spooky",
    angle: "Halloween: playful and a little mischievous, never gory or frightening. Seasonal items belong in the colours and the mood only, not in the story of the product. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop the haul",
    needsOffer: false,
  },
  {
    id: "dayofthedead",
    name: "Day of the Dead",
    description: "Marigold, purple and magenta, in the bright flat colours of papel picado. Celebratory and respectful: no religious or sacred imagery and no skulls.",
    swatch: ["#2B1140", "#F5A200", "#D81B7A"],
    palette: ["#2B1140", "#FFF3DC", "#F5A200", "#D81B7A"],
    mood: "celebratory, warm, remembering with joy",
    angle: "Day of the Dead (Dia de Muertos): celebratory and respectful, about warmth, colour and remembering people with love. Never use or mention skulls, skeletons, altars, saints, crosses or any religious or sacred imagery, and never make light of the occasion. The occasion is in the colours only. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop the colours",
    needsOffer: false,
    note: "Best for businesses with a connection to the tradition.",
  },
  {
    id: "valentines",
    name: "Valentine's Day",
    description: "Deep wine with rose and blush pink. Warm and affectionate, with a giftable angle.",
    swatch: ["#3A0F1E", "#E0245E", "#F28BA8"],
    palette: ["#3A0F1E", "#FFF0F2", "#E0245E", "#F28BA8"],
    mood: "warm, affectionate, a little shy",
    angle: "Valentine's Day: warm and affectionate, about giving something thoughtful to someone you love, friend or partner. No promises about romance or results. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop gifts",
    needsOffer: false,
  },
  {
    id: "newyear",
    name: "New Year",
    description: "Midnight blue with champagne gold and a cool blue. A fresh start, calm and optimistic.",
    swatch: ["#0E1230", "#D4AF37", "#7DA7FF"],
    palette: ["#0E1230", "#F6F1E4", "#D4AF37", "#7DA7FF"],
    mood: "fresh, hopeful, a clean start",
    angle: "New Year: a fresh start, calm and optimistic, about the year ahead and new habits. No resolutions promised and no claims about results. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Start fresh",
    needsOffer: false,
  },
  {
    id: "spring",
    name: "Spring",
    description: "Leaf green with blossom pink and fresh white. Light and new.",
    swatch: ["#1F3D2B", "#7BC96F", "#F4A6C1"],
    palette: ["#1F3D2B", "#F7FBF2", "#7BC96F", "#F4A6C1"],
    mood: "light, fresh, growing",
    angle: "Spring: light, fresh and new, about opening the windows and bringing life indoors. Seasonal items belong in the colours only. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop spring",
    needsOffer: false,
  },
  {
    id: "easter",
    name: "Easter",
    description: "Soft pastels: sky blue, butter yellow and lilac. A cheerful spring celebration, with no religious imagery.",
    swatch: ["#3B3355", "#9AD0F5", "#F7D26B"],
    palette: ["#3B3355", "#FFFBEF", "#9AD0F5", "#F7D26B"],
    mood: "cheerful, gentle, pastel",
    angle: "Easter: a cheerful spring celebration of family, food and getting together, in gentle pastel colours. Keep it secular: no religious claims or imagery. Seasonal items belong in the colours only. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop Easter",
    needsOffer: false,
  },
  {
    id: "mothersday",
    name: "Mother's Day",
    description: "Plum with rose and apricot. Warm and grateful, kind to everyone who is a mother figure.",
    swatch: ["#4A1D3A", "#E07BA0", "#F2B27A"],
    palette: ["#4A1D3A", "#FFF4F0", "#E07BA0", "#F2B27A"],
    mood: "warm, grateful, tender",
    angle: "Mother's Day: warm and grateful, about saying thank you to a mum or a mother figure with something thoughtful. Kind and inclusive; never assume who the reader is buying for. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop gifts",
    needsOffer: false,
  },
  {
    id: "summer",
    name: "Summer",
    description: "Deep sea blue with sunshine yellow and coral. Bright, easy and outdoors.",
    swatch: ["#0B3C5D", "#FFB400", "#FF6B4A"],
    palette: ["#0B3C5D", "#FFFBEA", "#FFB400", "#FF6B4A"],
    mood: "bright, easy, sunny",
    angle: "Summer: bright, easy and sunny, about long days, taking things outside and slowing down. Seasonal items belong in the colours only. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Shop summer",
    needsOffer: false,
  },
  {
    id: "backtoschool",
    name: "Back to School",
    description: "Navy with notebook cream, pencil orange and teal. Organised and ready.",
    swatch: ["#14213D", "#FCA311", "#2A9D8F"],
    palette: ["#14213D", "#FFF8E7", "#FCA311", "#2A9D8F"],
    mood: "organised, ready, a fresh page",
    angle: "Back to School: organised and ready, about a fresh start, tidy desks and getting set up for the term. No claims about marks or results. Never mention a delivery date, a deadline, a price, a discount or stock. Never invent an offer: only an offer the person typed may be used.",
    cta: "Get ready",
    needsOffer: false,
  },
];

/** The order in the dropdown: the most popular occasions first, and the one that needs care last. */
const THEME_ORDER: readonly ThemeId[] = ["christmas", "blackfriday", "valentines", "mothersday", "easter", "halloween", "summer", "backtoschool", "newyear", "spring", "autumn", "evergreen", "dayofthedead"];
export const THEMES: readonly Theme[] = [...THEMES_AS_WRITTEN].sort((a, b) => THEME_ORDER.indexOf(a.id) - THEME_ORDER.indexOf(b.id));

export const themeById = (id: string | undefined | null): Theme | null => THEMES.find((t) => t.id === id) ?? null;

// ---- the offer -----------------------------------------------------------------------------------

export const OFFER_MAX = 140;

// Words that claim scarcity or a delivery date, whoever typed them.
const SCARCITY = /\b(limited (stock|time|edition|supply|offer)|while (stocks?|supplies) last|last chance|only \d+ (left|remaining)|selling (out|fast)|almost gone|hurry|ends? (soon|tonight|today|tomorrow)|today only|don'?t miss|running out|few left|low stock)\b/i;
const DELIVERY = /\b((delivered?|delivery|arrives?|arrive|shipped?|shipping|order) (by|before|in time)|in time for|guaranteed (by|for)|next[- ]day|free delivery by)\b/i;

/** The first scarcity or delivery claim in a text, or null. */
export function forbiddenClaim(text: string): string | null {
  const m = text.match(SCARCITY) ?? text.match(DELIVERY);
  return m ? m[0] : null;
}

export interface OfferCheck {
  ok: boolean;
  offer: string; // the cleaned offer, when ok
  error: string | null; // a plain sentence when not
}

/** A sale theme needs an offer. The offer is what the person typed, cleaned of stray spaces, and never a scarcity or delivery claim. */
export function checkOffer(theme: Theme | null, typed: string | undefined | null): OfferCheck {
  const offer = (typed ?? "").replace(/\s+/g, " ").trim();
  if (theme?.needsOffer && !offer) return { ok: false, offer: "", error: `${theme.name} is a sale theme. Type the offer yourself (for example the discount or code you really have); it will not run without one.` };
  if (offer.length > OFFER_MAX) return { ok: false, offer, error: `The offer must be ${OFFER_MAX} characters or fewer.` };
  const bad = forbiddenClaim(offer);
  if (bad) return { ok: false, offer, error: `The offer says "${bad}". Ads here never claim scarcity or a delivery date, so remove it.` };
  return { ok: true, offer, error: null };
}

// Anything that looks like a figure the ad could invent: a percentage, an amount of money, a code, a date.
const FIGURES: readonly RegExp[] = [
  /\d+(?:[.,]\d+)?\s?%/g,
  /[$€£]\s?\d[\d.,]*/g,
  /\b\d[\d.,]*\s?(?:eur|euro|euros|usd|gbp|dollars?|pounds?)\b/gi,
  /\b(?:code|coupon|promo)\s+[A-Z0-9][A-Z0-9-]{2,}\b/gi,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
];

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/,/g, ".");

/**
 * The figures in the ad's words that are not in the offer the person typed. An empty list means the copy invented nothing.
 * "20% off" in a headline passes only when the typed offer contains "20%".
 */
export function inventedFigures(copy: string, typedOffer: string | undefined | null): string[] {
  const allowed = squash(typedOffer ?? "");
  const found: string[] = [];
  for (const re of FIGURES) for (const m of copy.match(re) ?? []) if (!allowed.includes(squash(m))) found.push(m.trim());
  return [...new Set(found)];
}

/** Whether the words of the ad are clean for a theme: no invented figure, no scarcity, no delivery claim. */
export function copyProblems(copy: string, typedOffer: string | undefined | null): string[] {
  const problems: string[] = [];
  const figures = inventedFigures(copy, typedOffer);
  if (figures.length) problems.push(`the copy states ${figures.map((f) => `"${f}"`).join(", ")}, which is not in the offer you typed`);
  const claim = forbiddenClaim(copy);
  if (claim) problems.push(`the copy says "${claim}", and ads here never claim scarcity or a delivery date`);
  return problems;
}

// The words that go on a design, each fact once, as the layout engine takes them. A small module with no model
// code in it, so the campaign pack can use it without touching anything that calls a model.
import { cleanCopy, dedupeBadge, dedupeDetails, type BriefType, type RoundPlan } from "./creativeDirectorPure.js";
import type { Brief } from "./brief.js";

export function designCopy(
  plan: Pick<RoundPlan, "headline" | "subline" | "cta" | "badge" | "ctaScale" | "gapScale">,
  brief: Pick<Brief, "eventDate" | "eventPlace" | "offer" | "clientName">,
  type: BriefType,
) {
  const clean = (s: string | undefined) => cleanCopy({ headline: s ?? "", body: "" }).headline;
  const raw = type === "event" ? [brief.eventDate, brief.eventPlace] : [brief.offer]; // the offer is the key detail
  const details = dedupeDetails(raw.map(clean).filter(Boolean), [plan.headline, plan.subline]);
  return {
    headline: plan.headline,
    subline: plan.subline,
    organiser: clean(brief.clientName),
    details,
    cta: plan.cta,
    badge: dedupeBadge(plan.badge, [plan.subline, plan.cta, ...details]),
    ctaScale: plan.ctaScale,
    gapScale: plan.gapScale,
  };
}

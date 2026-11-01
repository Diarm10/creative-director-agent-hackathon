// Catalogue mode. Load a catalogue (the bundled sample, or your own CSV and photos, up to 12), let each photo be
// checked, make ads for the ready products four at a time, then approve what you want and download it.
// Every ad goes through the same run as a single ad. Nothing is approved until you click Approve.
import { openingsToAvoid } from '../lib/meta/adCopy';
import { useEffect, useMemo, useRef, useState } from 'react';
import ProductCard from '../components/catalogue/ProductCard';
import ExportFeedback from '../components/ExportFeedback';
import { SAMPLE_CSV, SAMPLE_PHOTOS } from '../components/catalogue/sample';
import { prepPhoto } from '../lib/browser/prepPhoto';
import { runPool } from '../lib/catalogue/batch';
import { checkPhoto, findItemsInPhoto, freshRun, progressLine, reviseRun, saveFile, streamRun, tryEffect } from '../lib/catalogue/client';
import { readCatalogue, type CatalogueRow } from '../lib/catalogue/csv';
import { DEFAULT_CAMPAIGN, EFFECT_OPTIONS, LOOKS, THEMES, archetypeFor, campaignProblem, effectiveFor, nextEffect, requestStyle, type Campaign, type EffectChoice, type Override } from '../lib/catalogue/campaign';
import { itemLabel, itemsSummary, planItemRows, rescueDecision } from '../lib/meta/rescue';
import { addFeedback, deleteCampaign, listCampaigns, saveCampaign } from '../lib/browser/store';
import { buildFeedbackRow, editReason } from '../lib/meta/feedbackRow';
import { EFFECTS, STYLISED_NOTE } from '../lib/meta/effectInfo';
import { lookById } from '../lib/meta/looks';
import { themeById } from '../lib/meta/themes';
import { buildApprovedZip } from '../lib/catalogue/export';
import {
  BATCH_CONCURRENCY, MAX_PRODUCTS, durationText, pickDemoRows, adRound, bulkPlan, bulkSummary, MAX_MINUTES_PER_PRODUCT, MIN_MINUTES_PER_PRODUCT, estimateText, finalConcept, GROUP_LABEL, groupOf, readyItems, resultRows,
  type Approval, type CatalogueItem, type Group,
} from '../lib/catalogue/model';
import { nextRound, showRound, type Revising } from '../components/creative-director/runState';

const CHECK_CONCURRENCY = 3;
const BULK_CONCURRENCY = 4; // ads redrawn at once by "Effect for all ads"
const label = 'mb-1 block text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]';
const input = 'w-full rounded-lg border border-[var(--cm-border)] bg-[var(--cm-bg)] px-2.5 py-2 text-[13px] text-[var(--cm-text-primary)]';

const fileToDataUrl = async (blobOrUrl: Blob | string, name: string): Promise<string> => {
  const blob = typeof blobOrUrl === 'string' ? await (await fetch(blobOrUrl)).blob() : blobOrUrl;
  return prepPhoto(new File([blob], name, { type: blob.type || 'image/jpeg' }));
};

export default function Catalogue({ hasCode, active = true }: { hasCode: boolean; active?: boolean }) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [shop, setShop] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSample, setIsSample] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign>(DEFAULT_CAMPAIGN);
  const [campaignName, setCampaignName] = useState('');
  const [saved, setSaved] = useState<Record<string, Campaign>>(() => listCampaigns());
  const [campaignNote, setCampaignNote] = useState<string | null>(null);
  const [itemsNote, setItemsNote] = useState<string | null>(null);
  const [clock, setClock] = useState<{ startedAt: number | null; now: number; summary: string | null }>({ startedAt: null, now: 0, summary: null });
  useEffect(() => {
    if (clock.startedAt === null) return;
    const t = setInterval(() => setClock((c) => (c.startedAt === null ? c : { ...c, now: Date.now() })), 1000);
    return () => clearInterval(t);
  }, [clock.startedAt]);
  const [bulk, setBulk] = useState<{ total: number; done: number; failed: number; running: boolean; message: string | null } | null>(null);
  // A notice from an earlier moment (a stopped batch, a saved file) is cleared when the person changes tab.
  useEffect(() => { setStopNote(null); setExportNote(null); setCampaignNote(null); }, [active]);
  const itemsRef = useRef<CatalogueItem[]>([]);
  const revisingRef = useRef(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);

  const patch = (id: string, change: Partial<CatalogueItem> | ((i: CatalogueItem) => Partial<CatalogueItem>)) => {
    const next = itemsRef.current.map((i) => (i.id === id ? { ...i, ...(typeof change === 'function' ? change(i) : change) } : i));
    itemsRef.current = next;
    setItems(next);
  };
  const setAll = (next: CatalogueItem[]) => { itemsRef.current = next; setItems(next); };

  async function checkAll(list: CatalogueItem[]) {
    const { stopped } = await runPool(list, async (item) => {
      patch(item.id, { checkStatus: 'checking' });
      const { check, stop } = await checkPhoto(item.photoUrl, item.row.sku);
      patch(item.id, { check, checkStatus: 'done' });
      return stop;
    }, { concurrency: CHECK_CONCURRENCY, shouldStop: (s) => s?.message ?? null });
    if (stopped) setStopNote(stopped);
    // A photo the check never reached is held back rather than assumed fine.
    for (const item of itemsRef.current) {
      if (list.some((l) => l.id === item.id) && item.checkStatus !== 'done') patch(item.id, { check: { ran: false, flags: null, width: 0, height: 0, via: null }, checkStatus: 'done' });
    }
  }

  async function load(rows: CatalogueRow[], photoFor: (row: CatalogueRow) => Promise<string>) {
    setLoading(true);
    setMessage(null);
    setStopNote(null);
    setExportNote(null);
    try {
      const built: CatalogueItem[] = [];
      for (const row of rows) {
        built.push({
          id: row.sku, row, photoUrl: await photoFor(row), check: null, checkStatus: 'waiting', runAnyway: false,
          runStatus: 'idle', run: null, progress: '', error: null, approval: 'pending', override: undefined,
        });
      }
      setAll(built);
      setLoading(false);
      await checkAll(built);
    } catch {
      setMessage('A photo could not be read. Use JPEG or PNG files.');
      setLoading(false);
    }
  }

  async function loadSample() {
    const read = readCatalogue(SAMPLE_CSV);
    if (read.error) return setMessage(read.error);
    setIsSample(true);
    await load(read.rows, (row) => fileToDataUrl(SAMPLE_PHOTOS[row.image], row.image));
  }

  /** The Demo set: eight of the sample products, so the whole feature tour fits in a short video. */
  async function loadDemo() {
    const read = readCatalogue(SAMPLE_CSV);
    if (read.error) return setMessage(read.error);
    setIsSample(true);
    await load(pickDemoRows(read.rows), (row) => fileToDataUrl(SAMPLE_PHOTOS[row.image], row.image));
  }

  async function loadOwn() {
    const csvFile = csvRef.current?.files?.[0];
    const photos = Array.from(photosRef.current?.files ?? []);
    if (!csvFile) return setMessage('Choose your CSV file first.');
    if (photos.length > MAX_PRODUCTS) return setMessage(`You chose ${photos.length} photos. The limit is ${MAX_PRODUCTS}, so nothing was loaded. Choose up to ${MAX_PRODUCTS}.`);
    const read = readCatalogue(await csvFile.text());
    if (read.error) return setMessage(read.error);
    const byName = new Map(photos.map((f) => [f.name.toLowerCase(), f]));
    const missing = read.rows.filter((r) => !byName.has(r.image.toLowerCase())).map((r) => r.image);
    if (missing.length) return setMessage(`These photos are named in the CSV but were not chosen: ${missing.join(', ')}.`);
    setIsSample(false);
    await load(read.rows, (row) => fileToDataUrl(byName.get(row.image.toLowerCase()) as File, row.image));
  }

  /** So a batch does not repeat itself: the openings the finished ads already use, and this product's place in the batch. */
  const copyHints = (item: CatalogueItem): Record<string, unknown> => {
    const done = itemsRef.current.filter((i) => i.id !== item.id).map((i) => finalConcept(i)?.headline).filter((h): h is string => !!h);
    const avoid = openingsToAvoid(done);
    return { copyIndex: Math.max(0, itemsRef.current.findIndex((i) => i.id === item.id)), ...(avoid.length ? { copyAvoid: avoid } : {}) };
  };

  const body = (item: CatalogueItem): Record<string, unknown> => ({
    // The CSV's own shop and fact win; the shop box above is the default for rows with no shop.
    ...requestStyle(effectiveFor(campaign, item.override)),
    briefType: 'product', catalogue: true, quick: true, clientName: item.row.shop.trim() || shop.trim() || undefined, facts: item.row.fact.trim() || undefined, productNoun: item.row.product.trim(),
    audience: item.row.audience.trim() || 'online shoppers', channel: 'paid_social_square', productImageUrl: item.photoUrl,
    ...(item.rescued ? { rescue: true } : {}),
    ...copyHints(item),
  });

  async function makeOne(item: CatalogueItem) {
    patch(item.id, { runStatus: 'running', progress: 'Starting', error: null, approval: 'pending', working: 'Making the ad' });
    const outcome = await streamRun(body(item), freshRun(), (run) => patch(item.id, { run, progress: progressLine(run) }));
    const ok = outcome.run.status === 'done' && finalConcept({ run: outcome.run });
    patch(item.id, {
      run: outcome.run, progress: '', working: null,
      runStatus: outcome.stop ? 'not_run' : ok ? 'done' : 'failed',
      error: ok ? null : outcome.run.error ?? outcome.run.end?.message ?? 'This product did not finish.',
    });
    return outcome;
  }

  async function startBatch() {
    const list = readyItems(itemsRef.current);
    if (list.length === 0) return;
    setBatchRunning(true);
    setStopNote(null);
    setExportNote(null);
    for (const i of list) patch(i.id, { runStatus: 'queued', progress: 'Waiting for a free slot' });
    const started = Date.now();
    setClock({ startedAt: started, now: started, summary: null });
    const { stopped } = await runPool(list, makeOne, { concurrency: BATCH_CONCURRENCY, shouldStop: (o) => o.stop?.message ?? null });
    const finished = list.filter((i) => itemsRef.current.find((x) => x.id === i.id)?.runStatus === 'done').length;
    setClock({ startedAt: null, now: Date.now(), summary: `${finished} ad${finished === 1 ? '' : 's'} in ${durationText(Date.now() - started)}` });
    // Products the batch never reached go back to waiting, so Make ads can pick them up again.
    for (const i of itemsRef.current) if (i.runStatus === 'queued') patch(i.id, { runStatus: 'not_run', progress: '' });
    if (stopped) setStopNote(stopped);
    setBatchRunning(false);
  }

  /**
   * "Try anyway": the held-back photo is cut out by its product name; if that cut-out passes the check an ad is made on a studio or
   * type-behind layout and the fidelity check runs on it, otherwise the card stays held back and says so. Only a click starts it, and a
   * photo with a person, a brand or a watermark is refused here and again on the server.
   */
  async function tryAnyway(item: CatalogueItem) {
    const decision = rescueDecision(item.check, item.row.product);
    if (!decision.ok) return patch(item.id, { notice: decision.reason });
    if (revisingRef.current || batchRunning) return patch(item.id, { notice: 'Something else is being made right now, try again in a moment.' });
    revisingRef.current = true;
    setBatchRunning(true);
    patch(item.id, { rescued: true, notice: null, error: null });
    await makeOne({ ...item, rescued: true });
    setBatchRunning(false);
    revisingRef.current = false;
  }

  /** "Find items in this photo": a collection style photo becomes one row for each product in it. Only a click starts it. */
  async function findItems(item: CatalogueItem) {
    const decision = rescueDecision(item.check, item.row.product);
    if (!decision.ok) return patch(item.id, { notice: decision.reason });
    if (revisingRef.current || batchRunning) return patch(item.id, { notice: 'Something else is being made right now, try again in a moment.' });
    revisingRef.current = true;
    patch(item.id, { notice: null, working: 'Looking for items in the photo' });
    const found = await findItemsInPhoto(item.photoUrl);
    revisingRef.current = false;
    if (!found.ok) return patch(item.id, { working: null, notice: found.error });
    const plan = planItemRows(found.items.map((f) => ({ name: f.name, ok: f.ok, reason: f.reason, photo: f.photo })), itemsRef.current.length);
    const summary = itemsSummary(item.row.image, plan, found.items.length);
    if (plan.add.length === 0) return patch(item.id, { working: null, notice: summary });
    const rows: CatalogueItem[] = plan.add.map((f, n) => {
      const sku = `${item.row.sku}-item-${n + 1}-${f.name.replace(/[^a-z0-9]+/g, '-')}`.slice(0, 60);
      return {
        id: sku, row: { sku, product: f.name, audience: item.row.audience, image: itemLabel(f.name, item.row.image), shop: item.row.shop, fact: '' },
        photoUrl: f.photo as string, check: { ran: true, flags: { person_or_hand: false, several_products: false, visible_brand_or_logo: false, watermark: false, busy_background: false, low_resolution: false }, width: 1200, height: 1200, via: 'cut out on its own, from a photo that was checked' },
        checkStatus: 'done', runAnyway: false, runStatus: 'idle', run: null, progress: '', error: null, approval: 'pending', override: undefined,
      } as CatalogueItem;
    });
    // The photo they came from had no ad, so its row is replaced by its items.
    const list = itemsRef.current.flatMap((i) => (i.id === item.id ? rows : [i]));
    setAll(list);
    setItemsNote(summary);
  }

  /** Goes back to the ad the last revision started from. */
  function useEarlier(item: CatalogueItem) {
    const run = item.run;
    const c = finalConcept(item);
    if (!run || !c?.revisionOf) return;
    patch(item.id, { run: showRound(run, c.revisionOf.round), approval: 'pending', notice: null });
  }

  async function revise(item: CatalogueItem, note: string) {
    const run = item.run;
    const base = finalConcept(item);
    if (!run || !base?.plan) return;
    // One revision at a time: a second click says so instead of being ignored.
    if (revisingRef.current) return patch(item.id, { notice: 'Another revision is running, try again in a moment.' });
    if (batchRunning) return patch(item.id, { notice: 'Ads are being made right now, try again in a moment.' });
    revisingRef.current = true;
    patch(item.id, { notice: null });
    const next = nextRound(run.concepts);
    const rev: Revising = { fromRound: base.round, round: next, note, adRound: adRound(run.concepts) + 1 };
    patch(item.id, { runStatus: 'running', progress: `Revising as round ${rev.adRound}`, approval: 'pending', working: 'Revising' });
    const request = {
      ...body(item),
      revise: { fromRound: base.round, round: next, headline: base.headline, subline: base.body, cta: base.cta ?? '', plan: base.plan, note, weakness: base.weakness ?? '', fix: base.fix ?? '' },
    };
    setBatchRunning(true);
    const outcome = await streamRun(request, reviseRun(run, rev), (r) => patch(item.id, { run: r, progress: progressLine(r) }));
    const ok = outcome.run.status === 'done' && finalConcept({ run: outcome.run });
    // A revision that fails keeps the ad it started from: the person is told, and the earlier ad stays where it was.
    // The person is looking at the new ad, so it is the one shown, even if it scored lower than the earlier one.
    patch(item.id, ok ? { run: showRound(outcome.run, next), progress: '', runStatus: 'done', working: null, error: null } : { run, progress: '', runStatus: 'done', working: null, error: outcome.run.error ?? outcome.run.end?.message ?? 'The revision did not finish.'});
    if (outcome.stop) setStopNote(outcome.stop.message);
    setBatchRunning(false);
    revisingRef.current = false;
  }

  /** Applies the campaign to every product: each one's own Look or Effect is cleared. */
  function applyToAll() {
    setAll(itemsRef.current.map((i) => ({ ...i, override: undefined })));
    setCampaignNote('The campaign now applies to every product. Ads already made are not changed; make them again to see the new choices.');
  }

  function saveThisCampaign() {
    const ok = saveCampaign(campaignName, campaign);
    setSaved(listCampaigns());
    setCampaignNote(ok ? `Saved "${campaignName.trim()}" in this browser.` : campaignName.trim() ? 'This browser would not store the campaign.' : 'Type a name for the campaign first.');
  }

  function loadCampaign(name: string) {
    const c = saved[name];
    if (!c) return;
    setCampaign(c);
    setCampaignName(name);
    setCampaignNote(`Loaded "${name}".`);
  }

  function removeCampaign(name: string) {
    deleteCampaign(name);
    setSaved(listCampaigns());
    setCampaignNote(`Deleted "${name}".`);
  }

  /** Draws the final ad again with the next effect. No model call; the critic is not run again, so the ad is marked as not re-reviewed. */
  /**
   * Draws a finished ad again with the layout engine only: no model call, no new score, no daily limit used. Either the next effect, or
   * new words (and the same effect). Returns a plain sentence when it cannot, and the card keeps the ad it had.
   */
  async function redraw(item: CatalogueItem, change: { effect: 'next' | 'keep' | { id: EffectChoice['id'] }; text?: { headline: string; body: string; cta: string }; keepApproval?: boolean; look?: string }): Promise<string | null> {
    const run = item.run;
    const base = finalConcept(item);
    if (!run || !base?.plan || !run.cutoutB64 || !base.style?.effectable) return 'This ad is a photograph, so its words cannot be redrawn here. Make it again to change them.';
    const eff = effectiveFor(campaign, change.look ? { ...item.override, look: change.look } : item.override);
    const arch = change.look ? archetypeFor(eff.look, base.archetype === 'behind' ? 'behind' : 'product') : base.archetype;
    const current = base.style.effect;
    const next: string =
      change.effect === 'next' ? nextEffect(current, EFFECTS.map((e) => e.id))
      : change.effect === 'keep' ? (current ? current.id : 'none')
      : change.effect.id === 'default' ? (lookById(eff.look)?.effect ?? 'none') : change.effect.id;
    const bulk = typeof change.effect === 'object';
    const intensity = bulk ? eff.effect.intensity : current?.intensity ?? eff.effect.intensity;
    const text = change.text ?? { headline: base.headline, body: base.body, cta: base.cta ?? '' };
    patch(item.id, { progress: 'Drawing it again', working: 'Drawing it again', notice: null });
    const out = await tryEffect({
      concept: { archetype: arch, headline: text.headline, body: text.body, cta: text.cta, plan: base.plan },
      brief: { clientName: (item.row.shop.trim() || shop.trim()), offer: campaign.offer.trim() || undefined, facts: item.row.fact.trim() || undefined, look: eff.look, theme: eff.theme },
      cutoutB64: run.cutoutB64,
      effect: next === 'none' ? 'none' : { id: next, intensity, stylise: bulk ? eff.effect.stylise : current?.stylise ?? eff.effect.stylise },
    });
    if (!out.ok) {
      patch(item.id, { progress: '', working: null, notice: out.error });
      return out.error;
    }
    const edited = !!change.text;
    const changed = {
      ...base, imageB64: out.out.imageB64, imageMime: 'image/jpeg' as const,
      headline: text.headline, body: text.body, cta: text.cta,
      ...(change.look ? { archetype: arch, method: arch === 'behind' ? ('type behind product' as const) : ('layout composite' as const) } : {}),
      style: { ...base.style, ...(change.look ? { look: eff.look } : {}), effect: out.out.effect, stylised: !!out.out.effect?.stylise },
      ...(edited ? { edited: true } : bulk ? {} : { manualEffect: true }),
      unreviewed: edited
        ? 'The words were edited after the critic scored this ad, so the score is out of date. Look at it yourself, or revise it to have it scored again.'
        : change.look ? 'The Look was changed after the critic scored this ad, so the score is out of date. Look at it yourself, or revise it to have it scored again.'
        : 'The effect was changed after the critic scored this ad, so the score is out of date. Look at it yourself, or revise it to have it scored again.',
    };
    if (edited) {
      // Each edit is kept as feedback, before and after, so the feedback export carries it.
      addFeedback(buildFeedbackRow(
        { productFolioId: null, audience: item.row.audience.trim() || 'online shoppers', briefType: 'product', channel: 'paid_social_square' },
        { round: base.round, headline: text.headline, score: base.score, breakdown: base.breakdown ?? null },
        { score: base.score, direction: 'about_right', reason: editReason({ headline: base.headline, body: base.body, cta: base.cta ?? '' }, text) },
      ) as Parameters<typeof addFeedback>[0]);
    }
    const concepts = run.concepts.map((c) => (c.round === base.round ? changed : c));
    patch(item.id, { progress: '', working: null, notice: null, ...(change.keepApproval ? {} : { approval: 'pending' as const }), run: { ...run, concepts, notes: run.notes.filter((n) => !n.startsWith('The effect:')) } });
    return null;
  }

  const swapEffect = (item: CatalogueItem) => redraw(item, { effect: 'next' });

  /**
   * "Effect for all ads": every finished ad that was not set by hand is drawn again with the layout engine, four at a time. No model
   * call and no new scoring; the scores are marked out of date, edited words are kept, and approved ads stay approved.
   */
  async function effectForAll(id: EffectChoice['id']) {
    const plan = bulkPlan(itemsRef.current);
    if (plan.redraw.length === 0) return setBulk({ total: 0, done: 0, failed: 0, running: false, message: bulkSummary(0, 0, plan).replace('Redrew 0 ads. ', 'Nothing to redraw. ') });
    setBulk({ total: plan.redraw.length, done: 0, failed: 0, running: true, message: null });
    const t0 = Date.now();
    let done = 0;
    let failed = 0;
    await runPool(plan.redraw, async (item) => {
      const err = await redraw(item, { effect: { id }, keepApproval: true });
      if (err) failed++;
      else done++;
      setBulk({ total: plan.redraw.length, done: done + failed, failed, running: true, message: null });
    }, { concurrency: BULK_CONCURRENCY });
    setBulk({ total: plan.redraw.length, done: done + failed, failed, running: false, message: bulkSummary(done, failed, plan, Date.now() - t0) });
  }

  /** The effect an ad keeps when only its Look changes: its own if the person set one, else the campaign's. */
  const keptEffectId = (item: CatalogueItem): EffectChoice['id'] => {
    const base = finalConcept(item);
    return item.override?.effect?.id ?? (base?.manualEffect ? ((base.style?.effect?.id as EffectChoice['id'] | undefined) ?? 'none') : campaign.effect.id);
  };
  const photoOnlyNotice = 'This ad uses the whole photo, so a Look or an effect cannot be drawn on it. Looks and effects apply to cut-out ads only. The choice is kept for the next time this ad is made.';

  /** The Look dropdown on a card: remembered for the next run, and the finished ad is drawn again from its own words at once. No model call. */
  async function lookForItem(item: CatalogueItem, lookId: string) {
    const override = { ...item.override, look: lookId || undefined };
    patch(item.id, { override: override.look || override.effect ? override : undefined });
    const base = finalConcept(item);
    if (!base || !item.run || item.runStatus !== 'done') return;
    if (!base.style?.effectable || !item.run.cutoutB64) return void patch(item.id, { notice: photoOnlyNotice });
    await redraw({ ...item, override }, { effect: { id: keptEffectId(item) }, look: lookId || campaign.look, keepApproval: false });
  }

  /** The Effect dropdown on a card: the same, for the effect. */
  async function effectForItem(item: CatalogueItem, value: string) {
    const effect = value ? { ...campaign.effect, id: value as EffectChoice['id'] } : undefined;
    const override = { ...item.override, effect };
    patch(item.id, { override: override.look || override.effect ? override : undefined });
    const base = finalConcept(item);
    if (!value || !base || !item.run || item.runStatus !== 'done') return;
    if (!base.style?.effectable || !item.run.cutoutB64) return void patch(item.id, { notice: photoOnlyNotice });
    await redraw({ ...item, override }, { effect: { id: value as EffectChoice['id'] }, keepApproval: false });
  }

  /**
   * "Redraw finished ads with this Look": the campaign's Look, drawn again on every finished cut-out ad from its own words, four at a time.
   * No model call and no new scoring. An effect you set by hand is kept; photo ads are skipped and counted.
   */
  async function lookForAll() {
    const plan0 = bulkPlan(itemsRef.current);
    const list = [...plan0.redraw, ...plan0.byHand];
    const plan = { ...plan0, redraw: list, byHand: [] };
    if (list.length === 0) return setBulk({ total: 0, done: 0, failed: 0, running: false, message: bulkSummary(0, 0, plan).replace('Redrew 0 ads. ', 'Nothing to redraw. ') });
    setBulk({ total: list.length, done: 0, failed: 0, running: true, message: null });
    const t0 = Date.now();
    const lookId = campaign.look;
    let done = 0;
    let failed = 0;
    await runPool(list, async (item) => {
      const override = item.override?.effect ? { effect: item.override.effect } : undefined;
      patch(item.id, { override });
      const err = await redraw({ ...item, override }, { effect: { id: keptEffectId({ ...item, override }) }, look: lookId, keepApproval: true });
      if (err) failed++;
      else done++;
      setBulk({ total: list.length, done: done + failed, failed, running: true, message: null });
    }, { concurrency: BULK_CONCURRENCY });
    setBulk({ total: list.length, done: done + failed, failed, running: false, message: bulkSummary(done, failed, plan, Date.now() - t0) });
  }
  const applyText = (item: CatalogueItem, text: { headline: string; body: string; cta: string }) => redraw(item, { effect: 'keep', text });

  function download() {
    const zip = buildApprovedZip(itemsRef.current);
    if (!zip) return setExportNote('Nothing is approved yet. Approve the ads you want, then download.');
    saveFile(zip.bytes, 'approved-ads.zip', 'application/zip');
    setExportNote(`Saved approved-ads.zip with ${zip.count} ad${zip.count === 1 ? '' : 's'} and results.csv.`);
  }

  const ready = useMemo(() => readyItems(items), [items]);
  const problem = campaignProblem(campaign);
  const picked = { look: lookById(campaign.look), theme: themeById(campaign.theme), effect: EFFECT_OPTIONS.find((e) => e.id === campaign.effect.id) ?? EFFECT_OPTIONS[0] };
  const swatch = (colours: readonly string[]) => (
    <span className="inline-flex gap-0.5 align-middle" aria-hidden="true">{colours.map((c, i) => <span key={i} className="inline-block h-3.5 w-3.5 rounded-sm border border-[var(--cm-border)]" style={{ background: c }} />)}</span>
  );
  const checking = items.some((i) => i.checkStatus !== 'done');
  const approved = items.filter((i) => i.approval === 'approved').length;
  const inGroup = (g: Group) => items.filter((i) => groupOf(i) === g);
  const approvedAds = inGroup('approved');
  const held = inGroup('held');
  const check = inGroup('check');
  const readyAds = inGroup('ready');
  const pending = inGroup('pending');
  // The table appears once a batch has finished: something has an outcome and nothing is still running.
  const rows = resultRows(items);
  const showTable = !batchRunning && rows.length > 0 && items.some((i) => i.runStatus === 'done' || i.runStatus === 'failed' || i.runStatus === 'not_run');
  const section = (g: Group, title: string, list: CatalogueItem[], hint: string) =>
    list.length > 0 && (
      <section aria-label={title} className="mb-6" data-group={g}>
        <h2 className="mb-1 text-sm font-bold text-[var(--cm-text-primary)]">{title} ({list.length})</h2>
        <p className="mb-2 mt-0 text-xs text-[var(--cm-text-muted)]">{hint}</p>
        <div className="grid gap-3">{list.map(card)}</div>
      </section>
    );
  const card = (i: CatalogueItem) => (
    <ProductCard key={i.id} item={i} busy={batchRunning}
      onName={(v) => patch(i.id, (cur) => ({ row: { ...cur.row, product: v } }))}
      onRunAnyway={(v) => patch(i.id, { runAnyway: v })}
      campaign={campaign}
      onOverride={(o: Override | undefined) => patch(i.id, { override: o })}
      onLook={(v) => void lookForItem(i, v)}
      onEffectPick={(v) => void effectForItem(i, v)}
      onTryEffect={() => void swapEffect(i)}
      onApplyText={(t) => void applyText(i, t)}
      onUseEarlier={() => useEarlier(i)}
      onTryAnyway={() => void tryAnyway(i)}
      onFindItems={() => void findItems(i)}
      onApproval={(v: Approval) => patch(i.id, { approval: v })}
      onRevise={(n) => void revise(i, n)} />
  );

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <h1 className="m-0 text-[22px] font-black text-[var(--cm-text-primary)]">Catalogue</h1>
      <p className="mb-4 mt-1 text-[13px] text-[var(--cm-text-secondary)]">
        Make an ad for each product in a catalogue of up to {MAX_PRODUCTS}. Each photo is looked at first, and photos that are likely to go wrong are held back until you say so.
        You approve each ad yourself, and only approved ads are downloaded.
      </p>
      <details className="mb-4 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface)] px-3 py-2 text-xs text-[var(--cm-text-secondary)]" data-help>
        <summary className="cursor-pointer font-semibold text-[var(--cm-text-primary)]">How this page works</summary>
        <ul className="m-0 mt-2 list-disc pl-5 leading-relaxed">
          <li><strong>Look, Theme and Effect</strong> set how the ads are made: the layout, the occasion and a background effect. A sale theme needs an offer you type yourself; no discount, date or code is ever made up.</li>
          <li><strong>The words</strong> are written as three candidate lines for each product, and the best one that follows the rules is used. Every finished ad has boxes for the headline, subline and button text. <strong>Apply text</strong> redraws it at once, with no new score and no daily limit used. <strong>Show other lines</strong> offers the other candidates.</li>
          <li><strong>Effect for all ads</strong> redraws every finished ad with one effect, four at a time. Ads you set by hand are skipped, and your edited words and approvals are kept. Scores are then marked out of date.</li>
          <li><strong>Held back</strong> photos are never made by themselves. <strong>Try anyway</strong> cuts the product out by its name and only makes the ad if the cut-out is clean. <strong>Find items in this photo</strong> turns a photo of several things into a row for each thing, for a collection style catalogue. A photo with a person, a brand or a watermark is always refused.</li>
          <li><strong>Revise with my feedback</strong> never returns an unchanged ad in silence: it says what changed, or why it could not.</li>
        </ul>
      </details>
      {!hasCode && <p role="note" className="mb-3 rounded-lg border border-[var(--cm-border-strong)] px-3 py-2 text-xs text-[var(--cm-text-primary)]">Enter the demo code at the top right to check photos and make ads.</p>}

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => void loadSample()} disabled={loading || batchRunning || !hasCode} data-load-sample>Load the sample catalogue</button>
          <span className="text-xs text-[var(--cm-text-muted)]">12 sample products with photos, ready to try.</span>
          <button type="button" className="btn-ghost" onClick={() => void loadDemo()} disabled={loading || batchRunning || !hasCode} data-load-demo>Demo set</button>
          <span className="text-xs text-[var(--cm-text-muted)]">8 products for a short tour: five ads, a held-back flask, a collection photo and a refused photo.</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="cat-csv">Your catalogue CSV</label>
            <input id="cat-csv" ref={csvRef} type="file" accept=".csv,text/csv" className={input} />
            <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]">First row: sku, product, audience, image. The image column is the photo&rsquo;s file name. Optional columns: shop and fact.</p>
          </div>
          <div>
            <label className={label} htmlFor="cat-photos">Your photos (up to {MAX_PRODUCTS})</label>
            <input id="cat-photos" ref={photosRef} type="file" accept="image/*" multiple className={input} />
          </div>
        </div>
        <div><button type="button" className="btn-ghost" onClick={() => void loadOwn()} disabled={loading || batchRunning || !hasCode}>Load my catalogue</button></div>
        <div>
          <label className={label} htmlFor="cat-shop">Shop name (optional)</label>
          <input id="cat-shop" className={`${input} max-w-sm`} value={shop} maxLength={80} placeholder="Leave empty to print no shop name" onChange={(e) => setShop(e.target.value)} disabled={batchRunning} />
        </div>
      </div>

      {message && <div role="alert" className="mb-3 rounded-lg border border-[var(--cm-border-strong)] px-3 py-2 text-[13px] text-[var(--cm-text-primary)]">{message}</div>}
      {isSample && items.length > 0 && <p role="note" className="mb-3 text-xs font-semibold text-[var(--cm-text-secondary)]" data-sample-label>Sample catalogue, fictional shop</p>}
      {loading && <p role="status" className="text-xs text-[var(--cm-text-secondary)]">Loading photos</p>}

      {items.length > 0 && (
        <>
          <section aria-label="Campaign style" className="mb-4 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4" data-campaign>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className={label} htmlFor="pick-look">Look</label>
                <select id="pick-look" className={input} value={campaign.look} disabled={batchRunning} onChange={(e) => setCampaign({ ...campaign, look: e.target.value })} data-pick="look">
                  {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]" data-describe="look">{picked.look && swatch(picked.look.swatch)} {picked.look?.description}</p>
              </div>
              <div>
                <label className={label} htmlFor="pick-theme">Theme</label>
                <select id="pick-theme" className={input} value={campaign.theme} disabled={batchRunning} onChange={(e) => setCampaign({ ...campaign, theme: e.target.value })} data-pick="theme">
                  {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]" data-describe="theme">{picked.theme && swatch(picked.theme.swatch)} {picked.theme?.description}</p>
                {picked.theme?.note && <p className="m-0 mt-1 text-[11px] font-semibold text-[var(--cm-text-secondary)]" data-theme-note>{picked.theme.note}</p>}
              </div>
              <div>
                <label className={label} htmlFor="pick-effect">Effect</label>
                <select id="pick-effect" className={input} value={campaign.effect.id} disabled={batchRunning} onChange={(e) => setCampaign({ ...campaign, effect: { ...campaign.effect, id: e.target.value as EffectChoice['id'] } })} data-pick="effect">
                  {EFFECT_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]" data-describe="effect">{swatch(picked.effect.swatch)} {picked.effect.description}</p>
              </div>
            </div>
            {campaign.effect.id !== 'none' && (
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-[var(--cm-text-secondary)]" htmlFor="fx-intensity">Effect strength {campaign.effect.intensity}
                  <input id="fx-intensity" type="range" min={0} max={100} value={campaign.effect.intensity} disabled={batchRunning} onChange={(e) => setCampaign({ ...campaign, effect: { ...campaign.effect, intensity: Number(e.target.value) } })} data-fx-intensity />
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--cm-text-secondary)]">
                  <input type="checkbox" checked={campaign.effect.stylise} disabled={batchRunning} onChange={(e) => setCampaign({ ...campaign, effect: { ...campaign.effect, stylise: e.target.checked } })} data-stylise />
                  Stylise the product too
                </label>
                {campaign.effect.stylise && <span className="text-xs font-semibold text-[var(--cm-text-primary)]" data-stylise-warning>{STYLISED_NOTE} The fidelity check then compares shape only.</span>}
              </div>
            )}
            {picked.theme?.needsOffer && (
              <div className="mt-3" data-offer-box>
                <label className={label} htmlFor="cat-offer">Offer (required for {picked.theme.name})</label>
                <input id="cat-offer" className={`${input} max-w-md`} value={campaign.offer} maxLength={140} disabled={batchRunning} placeholder="The discount or code you really have, typed by you" onChange={(e) => setCampaign({ ...campaign, offer: e.target.value })} />
                <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]">Only what you type here is used. No percentage, date or code is ever made up, and no stock or delivery claims are made.</p>
              </div>
            )}
            {problem && <p role="alert" className="m-0 mt-2 text-xs font-semibold text-[var(--cm-text-primary)]" data-campaign-problem>{problem}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="btn-ghost" onClick={applyToAll} disabled={batchRunning} data-apply-all>Apply to all products</button>
              <input className={`${input} max-w-[220px]`} value={campaignName} maxLength={60} placeholder="Campaign name" aria-label="Campaign name" onChange={(e) => setCampaignName(e.target.value)} data-campaign-name />
              <button type="button" className="btn-ghost" onClick={saveThisCampaign} data-save-campaign>Save as campaign</button>
              {Object.keys(saved).length > 0 && (
                <>
                  <select className={`${input} max-w-[220px]`} value="" aria-label="Load a saved campaign" onChange={(e) => loadCampaign(e.target.value)} data-load-campaign>
                    <option value="">Load a saved campaign</option>
                    {Object.keys(saved).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {saved[campaignName] && <button type="button" className="btn-ghost" onClick={() => removeCampaign(campaignName)}>Delete this campaign</button>}
                </>
              )}
            </div>
            <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]">Campaigns are kept in this browser only. They are never sent anywhere except as the three choices on each run.</p>
            {campaignNote && <p role="status" className="m-0 mt-1 text-xs text-[var(--cm-text-secondary)]" data-campaign-note>{campaignNote}</p>}
          </section>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-4">
            <button type="button" className="btn-primary" onClick={() => void startBatch()} disabled={batchRunning || checking || ready.length === 0 || !hasCode || !!problem} data-make-ads>
              {batchRunning ? 'Making ads' : 'Make ads for the ready products'}
            </button>
            <span className="text-xs text-[var(--cm-text-secondary)]" data-estimate>
              {checking ? 'Checking photos' : ready.length === 0 ? 'No product is ready' : `${ready.length} ready: ${estimateText(ready.length)}. About ${MIN_MINUTES_PER_PRODUCT} to ${MAX_MINUTES_PER_PRODUCT} minutes per product, ${BATCH_CONCURRENCY} at a time. Keep this tab open.`}
            </span>
            {clock.startedAt !== null && <span role="status" className="text-xs font-semibold text-[var(--cm-text-primary)]" data-elapsed>Elapsed {durationText(clock.now - clock.startedAt)}</span>}
            {clock.startedAt === null && clock.summary && <span role="status" className="text-xs font-semibold text-[var(--cm-text-primary)]" data-run-summary>{clock.summary}</span>}
            <p className="m-0 basis-full text-[11px] text-[var(--cm-text-muted)]" data-trust>Nothing is added to your photos and nothing goes live until you approve it.</p>
            <span className="ml-auto flex items-center gap-2">
              <ExportFeedback resetKey={active} />
              <button type="button" className="btn-ghost" onClick={download} disabled={approved === 0} data-download>Download approved ads ({approved})</button>
            </span>
          </div>
          {items.some((i) => finalConcept(i)) && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] px-4 py-3" data-bulk-effect>
              <label className={label + ' mb-0'} htmlFor="bulk-effect">Effect for all ads</label>
              <select id="bulk-effect" className={input + ' max-w-[220px]'} value="" disabled={batchRunning || !!bulk?.running} onChange={(e) => e.target.value && void effectForAll(e.target.value as EffectChoice['id'])} data-bulk-pick>
                <option value="">Choose an effect</option>
                {EFFECT_OPTIONS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button type="button" className="btn-ghost" onClick={() => void lookForAll()} disabled={batchRunning || !!bulk?.running} data-look-all>Redraw finished ads with this Look</button>
              <span className="text-[11px] text-[var(--cm-text-muted)]">Redraws every finished ad at once, four at a time. No model call and no new scores. Ads whose effect you set by hand are left alone.</span>
              {bulk?.running && <span role="status" className="text-xs font-semibold text-[var(--cm-text-primary)]" data-bulk-progress>Working... {bulk.done} of {bulk.total} ads redrawn</span>}
              {bulk && !bulk.running && bulk.message && <span role="status" className="text-xs text-[var(--cm-text-secondary)]" data-bulk-message>{bulk.message}</span>}
            </div>
          )}
          {itemsNote && <div role="status" className="mb-3 rounded-lg border border-[var(--cm-border)] px-3 py-2 text-[13px] text-[var(--cm-text-primary)]" data-items-note>{itemsNote}</div>}
          {stopNote && <div role="alert" className="mb-3 rounded-lg border border-[var(--cm-border-strong)] px-3 py-2 text-[13px] text-[var(--cm-text-primary)]" data-stop>{stopNote}</div>}
          {exportNote && <div role="status" className="mb-3 text-xs text-[var(--cm-text-secondary)]">{exportNote}</div>}

          {showTable && (
            <section aria-label="Results" className="mb-6 overflow-x-auto" data-results-table>
              <h2 className="mb-2 text-sm font-bold text-[var(--cm-text-primary)]">Results</h2>
              <table className="w-full min-w-[720px] border-collapse text-left text-xs text-[var(--cm-text-primary)]">
                <thead>
                  <tr className="border-b border-[var(--cm-border-strong)] text-[10px] uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">
                    {['File', 'Product', 'Headline', 'Score', 'Group', 'Reviewed by'].map((h) => <th key={h} className="px-2 py-1.5 font-bold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.file} className="border-b border-[var(--cm-border)] align-top">
                      <td className="px-2 py-1.5 font-semibold">{r.file}</td>
                      <td className="px-2 py-1.5">{r.product}</td>
                      <td className="px-2 py-1.5">{r.headline || '(no ad)'}</td>
                      <td className="px-2 py-1.5">{r.score || '-'}</td>
                      <td className="px-2 py-1.5">{r.group}</td>
                      <td className="px-2 py-1.5">{r.reviewer || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {section('approved', GROUP_LABEL.approved, approvedAds, 'Ads you have approved. These are the ones the download holds.')}
          {section('held', GROUP_LABEL.held, held, 'Stopped before any ad was made. The reason is on each card.')}
          {section('check', GROUP_LABEL.check, check, 'Finished ads scoring under 8. The biggest problem is named on each card.')}
          {section('ready', GROUP_LABEL.ready, readyAds, 'Finished ads scoring 8 or more that you have not approved yet.')}
          {section('pending', 'Not made yet', pending, 'Waiting for a free slot, running, or ready to make.')}
        </>
      )}
    </div>
  );
}

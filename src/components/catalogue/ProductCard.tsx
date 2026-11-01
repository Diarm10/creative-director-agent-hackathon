// One product in Catalogue mode: its original photo and file name, what is wrong with it before a run, and after a run
// the finished ad beside the original with the score, the single biggest problem in plain words and the sign-off buttons.
import { useEffect, useState } from 'react';
import { MAX_REVISION_ROUND } from '../../lib/meta/runEnd';
import { revisionOutcome } from '../../lib/meta/lookCompare';
import {
  adRound, attentionReasons, biggestProblem, criticLine, finalConcept, GROUP_LABEL, groupOf, heldReasons, isReady, isWorking, nameMissing, resultProblems,
  type CatalogueItem,
} from '../../lib/catalogue/model';
import { Thumb } from './Lightbox';
import { ITEMS_NOTE, rescueDecision } from '../../lib/meta/rescue';
import { EFFECT_OPTIONS, LOOKS, effectiveFor, type Campaign, type Override } from '../../lib/catalogue/campaign';
import { lookById } from '../../lib/meta/looks';
import { themeById } from '../../lib/meta/themes';
import { effectById, STYLISED_NOTE } from '../../lib/meta/effectInfo';

const inputClass = 'w-full rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg)] px-2 py-1 text-xs text-[var(--cm-text-primary)]';
const note = 'text-xs leading-relaxed text-[var(--cm-text-secondary)]';

interface Props {
  item: CatalogueItem;
  busy: boolean; // a batch is running, so held products cannot be changed under it
  onName: (value: string) => void;
  onRunAnyway: (value: boolean) => void;
  onApproval: (value: 'approved' | 'rejected' | 'pending') => void;
  onRevise: (note: string) => void;
  campaign: Campaign; // the campaign's choices; this product may override the Look or the Effect
  onOverride: (o: Override | undefined) => void;
  onLook: (lookId: string) => void; // the Look dropdown: remembered, and a finished cut-out ad is drawn again at once
  onEffectPick: (effectId: string) => void; // the Effect dropdown, the same
  onTryEffect: () => void;
  onUseEarlier: () => void; // after a revision: go back to the ad it started from
  onTryAnyway: () => void; // a held-back photo: cut the product out by name and make the ad only if the cut-out passes its check
  onFindItems: () => void; // a photo of several things: one row for each
  onApplyText: (text: { headline: string; body: string; cta: string }) => void; // draws the ad again with these words, no model call
}

export default function ProductCard({ item, busy, onName, onRunAnyway, onApproval, onRevise, campaign, onLook, onEffectPick, onTryEffect, onUseEarlier, onApplyText, onTryAnyway, onFindItems }: Props) {
  const [reviseNote, setReviseNote] = useState('');
  const [draft, setDraft] = useState({ headline: '', body: '', cta: '' });
  const [showOthers, setShowOthers] = useState(false);
  const concept = finalConcept(item);
  // The words in the boxes follow the ad on the card; typing changes only the boxes until Apply text.
  useEffect(() => {
    if (concept) setDraft({ headline: concept.headline, body: concept.body, cta: concept.cta ?? '' });
    setShowOthers(false);
  }, [concept?.round, concept?.headline, concept?.body, concept?.cta]);
  const group = groupOf(item);
  const reasons = heldReasons(item);
  const photoReasons = attentionReasons(item.check);
  const rescue = rescueDecision(item.check, item.row.product);
  const flagged = !!(item.check?.flags?.several_products || item.check?.flags?.busy_background);
  const approved = item.approval === 'approved';
  const running = isWorking(item);
  const WORKING = 'Working on this ad...';
  // The revise box stays on the card while it works, switched off and labelled, so nothing jumps or disappears.
  const canRevise = !!concept?.plan && Math.max(...(item.run?.concepts.map((c) => c.round) ?? [0])) < MAX_REVISION_ROUND;
  const locked = running || busy;
  // A revision that changed nothing says so, instead of passing the same ad off as new.
  const outcome = concept?.revisionOf && item.run ? revisionOutcome(item.run.concepts, concept) : null;

  const earlier = concept?.revisionOf ? item.run?.concepts.find((c) => c.round === concept.revisionOf?.round) : undefined;
  const eff = effectiveFor(campaign, item.override);
  const styleLine = [lookById(eff.look)?.name, themeById(eff.theme)?.name, EFFECT_OPTIONS.find((e) => e.id === eff.effect.id)?.name].filter(Boolean).join(' / ');
  const canTryEffect = !!concept?.style?.effectable && !!item.run?.cutoutB64;
  // What is really on the ad now, so the dropdowns show it instead of "Campaign".
  const appliedLook = concept?.style?.look ?? '';
  const appliedEffect = concept?.style ? (concept.style.effect?.id ?? 'none') : '';
  const fromFile = item.row.image.includes(' (from ') ? item.row.image.slice(item.row.image.indexOf(' (from ') + 7, item.row.image.lastIndexOf(')')) : '';
  const textEditable = canTryEffect;
  const draftChanged = !!concept && (draft.headline !== concept.headline || draft.body !== concept.body || draft.cta !== (concept.cta ?? ''));

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-3" data-sku={item.row.sku} data-state={item.runStatus} data-group={group} data-working={running ? 'true' : undefined} aria-busy={running} aria-label={`Product ${item.row.sku}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-bold text-[var(--cm-text-primary)]" data-file>{item.row.image}</span>
        <span className="text-xs text-[var(--cm-text-muted)]">{item.row.product}</span>
        {fromFile && <span className="stage-badge" data-from-file>From {fromFile}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--cm-text-secondary)]" data-style-line>
        <span>Style: {styleLine}{item.override ? ' (this product only)' : ''}</span>
        <label className="flex items-center gap-1">Look
          <select className={inputClass + ' w-auto'} value={item.override?.look ?? appliedLook} disabled={locked} aria-label={`Look for ${item.row.product}`} data-override="look"
            onChange={(e) => onLook(e.target.value)}>
            <option value="">Campaign</option>
            {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Effect
          <select className={inputClass + ' w-auto'} value={item.override?.effect?.id ?? appliedEffect} disabled={locked} aria-label={`Effect for ${item.row.product}`} data-override="effect"
            onChange={(e) => onEffectPick(e.target.value)}>
            <option value="">Campaign</option>
            {EFFECT_OPTIONS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <Thumb src={item.photoUrl} alt={`Original photo ${item.row.image} of ${item.row.product}`} caption="Original" />
        {concept && concept.imageB64 && (
          <Thumb src={`data:${concept.imageMime};base64,${concept.imageB64}`} alt={`Finished ad for ${item.row.product} from ${item.row.image}`} caption="Finished ad" />
        )}
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]" htmlFor={`name-${item.id}`}>
          Product ({item.row.sku})
        </label>
        <input id={`name-${item.id}`} className={inputClass} value={item.row.product} disabled={locked} placeholder="What is this product?" onChange={(e) => onName(e.target.value.slice(0, 80))} />
      </div>

      {item.checkStatus !== 'done' && <p className={note}>{item.checkStatus === 'checking' ? 'Checking the photo' : 'Waiting to check the photo'}</p>}

      {group === 'held' && (
        <div className="rounded-md border border-[var(--cm-border-strong)] px-2.5 py-2" data-held>
          <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">{GROUP_LABEL.held}: no ad was made</p>
          <ul className="m-0 list-disc pl-4 text-xs text-[var(--cm-text-primary)]">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {item.runStatus === 'idle' && photoReasons.length > 0 && rescue.ok && (
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--cm-text-secondary)]">
              <input type="checkbox" checked={item.runAnyway} disabled={locked || nameMissing(item)} onChange={(e) => onRunAnyway(e.target.checked)} />
              Run anyway
            </label>
          )}
          {item.runStatus === 'idle' && photoReasons.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5" data-rescue>
              {rescue.ok ? (
                <div className="flex flex-wrap items-center gap-2">
                  {!item.rescued && <button type="button" className="btn-ghost" disabled={locked} onClick={onTryAnyway} data-try-anyway>Try anyway</button>}
                  {flagged && !item.row.image.includes(' (from ') && <button type="button" className="btn-ghost" disabled={locked} onClick={onFindItems} data-find-items>Find items in this photo</button>}
                  <span className={note}>Try anyway cuts the product out by its name. If the cut-out is not clean, it stays held back. Find items turns a photo of several things into a row for each. {flagged ? ITEMS_NOTE : ''}</span>
                </div>
              ) : (
                <p className={note} data-rescue-refused>{rescue.reason}</p>
              )}
            </div>
          )}
          {item.runStatus === 'idle' && photoReasons.length > 0 && rescue.ok && !isReady(item) && <p className={`${note} mt-1`}>This product will not be made until you tick Run anyway{nameMissing(item) ? ' and add a name' : ''}.</p>}
        </div>
      )}

      {running && (
        <p className="m-0 flex items-center gap-2 rounded-md border border-[var(--cm-border-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--cm-text-primary)]" role="status" data-working-line>
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--cm-accent)]" aria-hidden="true" />
          {WORKING} <span className="font-normal text-[var(--cm-text-secondary)]">{item.working ? `${item.working}. ` : ''}{item.progress || 'Waiting for a free slot'}</span>
        </p>
      )}
      {item.notice && <p className="m-0 text-xs font-semibold text-[var(--cm-text-primary)]" role="status" data-notice>{item.notice}</p>}
      {item.runStatus === 'done' && item.error && !running && <p className="m-0 text-xs font-semibold text-[var(--cm-text-primary)]" role="alert" data-revision-error>The last change did not finish, so the earlier ad is still here: {item.error}</p>}

      {(item.run?.notes ?? []).map((n) => <p key={n} className={note} data-fallback-note>{n}</p>)}

      {concept && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-[var(--cm-text-primary)]">{concept.unreviewed ? <>Not re-reviewed (was {concept.score} out of 10)</> : <>Score {concept.score} out of 10</>}</span>
            {concept.style?.effect && <span className="stage-badge" data-effect-badge>{effectById(concept.style.effect.id)?.name} {concept.style.effect.intensity}</span>}
            {concept.style?.stylised && <span className="stage-badge active" data-stylised>{STYLISED_NOTE}</span>}
            <span className="stage-badge">{concept.direction ?? 'Design'}</span>
            {item.run && <span className="stage-badge" data-ad-round>Round {adRound(item.run.concepts)}</span>}
            {approved ? (
              <span className="stage-badge approved" data-badge="approved">Approved</span>
            ) : (
              <span className={`stage-badge ${group === 'check' ? 'active' : ''}`} data-badge={group}>{group === 'check' ? GROUP_LABEL.check : GROUP_LABEL.ready}</span>
            )}
            {concept.edited && <span className="stage-badge active" data-edited>Edited by you</span>}
            {item.approval === 'rejected' && <span className="stage-badge">Rejected</span>}
          </div>
          {item.rescued && <p className={note} data-rescue-note>Cut out by name. The cut-out passed the clean check.</p>}
          <div className="text-sm font-bold text-[var(--cm-text-primary)]">{concept.headline}</div>
          {concept.body && <div className={note}>{concept.body}</div>}
          {textEditable ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-[var(--cm-border)] p-2" data-text-edit>
              <div className="grid gap-1.5 sm:grid-cols-3">
                <label className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">Headline
                  <input className={inputClass + ' mt-0.5 font-normal normal-case tracking-normal'} value={draft.headline} maxLength={60} disabled={locked} aria-label={`Headline for ${item.row.product}`} data-edit="headline" onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">Subline
                  <input className={inputClass + ' mt-0.5 font-normal normal-case tracking-normal'} value={draft.body} maxLength={70} disabled={locked} aria-label={`Subline for ${item.row.product}`} data-edit="body" onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                </label>
                <label className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]">Button text
                  <input className={inputClass + ' mt-0.5 font-normal normal-case tracking-normal'} value={draft.cta} maxLength={30} disabled={locked} aria-label={`Button text for ${item.row.product}`} data-edit="cta" onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost" disabled={locked || !draftChanged || !draft.headline.trim()} data-apply-text onClick={() => onApplyText({ headline: draft.headline.trim(), body: draft.body.trim(), cta: draft.cta.trim() })}>{running ? WORKING : 'Apply text'}</button>
                {(concept.alternatives?.length ?? 0) > 0 && <button type="button" className="btn-ghost" disabled={locked} data-show-lines onClick={() => setShowOthers(!showOthers)}>{showOthers ? 'Hide other lines' : 'Show other lines'}</button>}
                <span className="text-[11px] text-[var(--cm-text-muted)]">Redraws at once. No model call, no new score, no daily limit used.</span>
              </div>
              {showOthers && (
                <div className="flex flex-col gap-1" data-other-lines>
                  {concept.alternatives?.map((a) => (
                    <button key={a.headline + a.subline} type="button" className="btn-ghost text-left" disabled={locked} data-other-line onClick={() => onApplyText({ headline: a.headline, body: a.subline, cta: concept.cta ?? '' })}>
                      <strong>{a.headline}</strong>{a.subline ? ` / ${a.subline}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className={note} data-text-locked>The words on this ad are part of a photograph, so they cannot be redrawn here. Make the ad again to change them.</p>
          )}
          {!approved && group === 'check' && (
            <>
              <p className="m-0 text-xs text-[var(--cm-text-primary)]" data-biggest-problem><strong>Biggest problem:</strong> {biggestProblem(concept)}</p>
              {resultProblems(item).length > 1 && (
                <details className={note}>
                  <summary className="cursor-pointer">All findings</summary>
                  <ul className="m-0 list-disc pl-4" data-problems>{resultProblems(item).map((p) => <li key={p}>{p}</li>)}</ul>
                </details>
              )}
            </>
          )}
          {earlier && concept.revisionOf && (
            <p className={note} data-compare>
              This revision scored {concept.score} out of 10; the ad before it scored {earlier.score}.{' '}
              <button type="button" className="btn-ghost" disabled={locked} onClick={onUseEarlier} data-use-earlier>Go back to the earlier ad</button>
            </p>
          )}
          {outcome && !outcome.changed && <p className="m-0 rounded-md border border-[var(--cm-border-strong)] px-2 py-1.5 text-xs font-semibold text-[var(--cm-text-primary)]" role="status" data-no-change>{outcome.message}</p>}
          {outcome?.changed && (concept.revisionOf?.applied?.length ?? 0) > 0 && <p className={note} data-applied>Changed: {concept.revisionOf?.applied?.join('; ')}.</p>}
          <p className={note} data-critic-line>{criticLine(concept)}</p>

          <div className="flex flex-wrap items-center gap-2">
            {canTryEffect && <button type="button" className="btn-ghost" disabled={locked} onClick={onTryEffect} data-try-effect>{running ? WORKING : 'Try another effect'}</button>}
            {!canTryEffect && <span className={note} data-no-effects>Effects apply to cut-out ads only</span>}
            <button type="button" className="btn-primary" disabled={locked || approved} onClick={() => onApproval('approved')}>{running ? WORKING : 'Approve'}</button>
            <button type="button" className="btn-ghost" disabled={locked || item.approval === 'rejected'} onClick={() => onApproval('rejected')}>{running ? WORKING : 'Reject'}</button>
            {item.approval !== 'pending' && <button type="button" className="btn-ghost" disabled={locked} onClick={() => onApproval('pending')}>{running ? WORKING : 'Undo'}</button>}
          </div>

          {canRevise && (
            <div className="flex flex-col gap-1.5">
              <textarea className={inputClass} rows={2} value={reviseNote} maxLength={300} disabled={running} onChange={(e) => setReviseNote(e.target.value)} placeholder="What should change? For example: make the headline smaller" aria-label={`Feedback for ${item.row.product}`} />
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost" disabled={running} data-revise onClick={() => { onRevise(reviseNote.trim()); setReviseNote(''); }}>{running ? WORKING : 'Revise with my feedback'}</button>
                <span className="text-[11px] text-[var(--cm-text-muted)]">One new round. It counts toward your daily limit.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

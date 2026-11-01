// A small editor for your own folios. They are saved in this browser only and sent with a run.
import { useState } from 'react';
import type { Folio } from '../../lib/meta/folio';
import { CHANNELS, type CreativeChannel } from '../../lib/meta/brief';
import { CHANNEL_LABELS } from './channels';

const label = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--cm-text-secondary)]';
const field = 'w-full rounded-lg border border-[var(--cm-border)] bg-[var(--cm-bg)] px-2.5 py-2 text-[13px] text-[var(--cm-text-primary)] font-[inherit]';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commas = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

interface FormState {
  brand_name: string; product_name: string; brand_colours: string; tone_notes: string; product_specs: string; target_customer: string;
  approved_facts: string; approved_claims: string; banned_claims: string; banned_words: string; audience_notes: string; channels: CreativeChannel[];
}

function toForm(f: Folio | null): FormState {
  return {
    brand_name: f?.brand_name ?? '', product_name: f?.product_name ?? '', brand_colours: (f?.brand_colours ?? []).join(', '),
    tone_notes: f?.tone_notes ?? '', product_specs: f?.product_specs ?? '', target_customer: f?.target_customer ?? '',
    approved_facts: (f?.approved_facts ?? []).join('\n'), approved_claims: (f?.approved_claims ?? []).join('\n'),
    banned_claims: (f?.banned_claims ?? []).join('\n'), banned_words: (f?.banned_words ?? []).join(', '),
    audience_notes: f?.audience_notes ?? '', channels: f?.channels ?? [],
  };
}

interface Props {
  folio: Folio | null; // null creates a new one
  onClose: () => void;
  onSave: (folio: Omit<Folio, 'id'> & { id?: string }) => void;
  onDelete?: () => void;
}

export default function FolioEditor({ folio, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(folio));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (c: CreativeChannel) => set('channels', form.channels.includes(c) ? form.channels.filter((x) => x !== c) : [...form.channels, c]);

  const text = (k: keyof FormState, l: string, placeholder = '') => (
    <div>
      <label className={label}>{l}</label>
      <input className={field} value={form[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </div>
  );
  const area = (k: keyof FormState, l: string, placeholder = '') => (
    <div className="sm:col-span-2">
      <label className={label}>{l}</label>
      <textarea className={`${field} resize-y`} rows={3} value={form[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
    </div>
  );

  function save() {
    onSave({
      id: folio?.id,
      brand_name: form.brand_name.trim(), product_name: form.product_name.trim(), brand_colours: commas(form.brand_colours),
      tone_notes: form.tone_notes.trim(), product_specs: form.product_specs.trim(), target_customer: form.target_customer.trim(),
      approved_facts: lines(form.approved_facts), approved_claims: lines(form.approved_claims), banned_claims: lines(form.banned_claims),
      banned_words: commas(form.banned_words), audience_notes: form.audience_notes.trim(), channels: form.channels,
    });
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-[rgba(0,0,0,0.6)] p-4" role="dialog" aria-modal="true" aria-label="Folio editor">
      <div className="max-h-[90vh] w-full max-w-[720px] overflow-y-auto rounded-xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-5">
        <h2 className="m-0 mb-1 text-lg font-bold text-[var(--cm-text-primary)]">{folio ? 'Edit your folio' : 'New folio'}</h2>
        <p className="m-0 mb-4 text-xs text-[var(--cm-text-secondary)]">
          The agent only uses the approved facts and claims here, and blocks any round that uses a banned word or claim. Folios you make are saved in this browser only.
        </p>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {text('brand_name', 'Brand name', 'e.g. Sparks Audio')}
          {text('product_name', 'Product name', 'e.g. Sparks Pocket earbuds')}
          {text('brand_colours', 'Brand colours (comma separated hex codes)', '#1A7F64, #F4F1EA')}
          {text('target_customer', 'Target customer', 'e.g. commuters who lose earbuds')}
          {area('product_specs', 'Product specs')}
          {area('tone_notes', 'Tone notes', 'e.g. plain, warm, no hype')}
          {area('approved_facts', 'Approved facts (one per line)')}
          {area('approved_claims', 'Approved claims (one per line)')}
          {area('banned_claims', 'Banned claims (one per line)')}
          {text('banned_words', 'Banned words (comma separated)', 'e.g. cure, best ever')}
          {area('audience_notes', 'Audience notes')}
          <div className="sm:col-span-2">
            <label className={label}>Channels</label>
            <div className="flex flex-wrap gap-3">
              {CHANNELS.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-[13px] text-[var(--cm-text-primary)]">
                  <input type="checkbox" checked={form.channels.includes(c)} onChange={() => toggle(c)} /> {CHANNEL_LABELS[c]}
                </label>
              ))}
            </div>
            <p className="m-0 mt-1 text-[11px] text-[var(--cm-text-muted)]">Leave all unticked to allow every channel.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {folio && onDelete && <button className="btn-ghost" onClick={onDelete}>Delete</button>}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={!form.brand_name.trim() || !form.product_name.trim()}>Save folio</button>
          </div>
        </div>
      </div>
    </div>
  );
}

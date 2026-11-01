// The Creative Director page. Pick a folio, give a short brief (a product photo, an event poster or a promo),
// and the agent (src/lib/meta/loop.ts, run server side by api/run.ts) plans, designs, critiques and revises
// in up to three rounds, streaming each round in as it lands (RunStage). Folios, feedback and past winners
// live in this browser.
import { useMemo, useState } from 'react';
import RunStage from '../components/creative-director/RunStage';
import FolioEditor from '../components/creative-director/FolioEditor';
import { CHANNEL_LABELS } from '../components/creative-director/channels';
import { PRODUCT_FIELD_HINT, PRODUCT_FIELD_LABEL, PRODUCT_FIELD_PLACEHOLDER, looksLikeSlogan } from '../components/creative-director/fieldHints';
import type { RunStatus } from '../components/creative-director/runState';
import { CHANNELS, type CreativeChannel } from '../lib/meta/brief';
import type { Folio } from '../lib/meta/folio';
import { deleteUserFolio, loadUserFolios, saveUserFolio } from '../lib/browser/store';
import { prepPhoto } from '../lib/browser/prepPhoto';
import mugPhotoUrl from '../../demo-assets/mug.jpg';

const MAX_FACTS_LENGTH = 500;
const MAX_BRAND_COLOURS_LENGTH = 100;

type BriefType = 'product' | 'event' | 'promo';
const BRIEF_TYPES: { value: BriefType; label: string }[] = [
  { value: 'product', label: 'Product ad' },
  { value: 'event', label: 'Event poster' },
  { value: 'promo', label: 'Promo or announcement' },
];

// The two fictional demo folios are JSON files in /folios, bundled here by Vite.
const builtIn = Object.values(import.meta.glob<Folio>('../../folios/*.json', { eager: true, import: 'default' }));

const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--cm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 } as const;
const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--cm-border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--cm-bg)', color: 'var(--cm-text-primary)' } as const;
const linkButton = { background: 'none', border: 'none', padding: 0, color: 'var(--cm-accent)', cursor: 'pointer', fontSize: 12 } as const;

interface RunInfo {
  id: number;
  body: Record<string, unknown>;
  channel: CreativeChannel;
  briefType: BriefType;
  folioId: string | null;
  audience: string;
}

export default function CreativeDirector({ hasCode, active = true }: { hasCode: boolean; active?: boolean }) {
  const [userFolios, setUserFolios] = useState<Folio[]>(() => loadUserFolios());
  const folios = useMemo(() => [...builtIn, ...userFolios], [userFolios]);
  const [folioId, setFolioId] = useState('');
  const [editing, setEditing] = useState<Folio | null | 'new'>(null);
  const [briefType, setBriefType] = useState<BriefType>('product');
  const [channel, setChannel] = useState<CreativeChannel>('paid_social_square');
  const [clientName, setClientName] = useState('');
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventPlace, setEventPlace] = useState('');
  const [cta, setCta] = useState('');
  const [productNoun, setProductNoun] = useState('');
  const [offer, setOffer] = useState('');
  const [audience, setAudience] = useState('');
  const [facts, setFacts] = useState('');
  const [brandColours, setBrandColours] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [usingMug, setUsingMug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const running = runStatus === 'connecting' || runStatus === 'running';

  const folio = folios.find((f) => f.id === folioId) ?? null;
  const allowedChannels = folio?.channels.length ? folio.channels : CHANNELS;

  function applyFolio(f: Folio | null) {
    setFolioId(f?.id ?? '');
    if (!f) return;
    setClientName(f.brand_name);
    setProductNoun(f.product_name);
    setAudience(f.target_customer || f.audience_notes);
    setFacts([...f.approved_facts, ...f.approved_claims].join('; ').slice(0, MAX_FACTS_LENGTH));
    setBrandColours(f.brand_colours.join(', ').slice(0, MAX_BRAND_COLOURS_LENGTH));
    if (f.channels.length && !f.channels.includes(channel)) setChannel(f.channels[0]);
  }

  // The bundled example: the mug photo from demo-assets and a short brief for it, so the product flow can be tried without a photo of your own.
  async function loadMugExample() {
    setError(null);
    try {
      const blob = await (await fetch(mugPhotoUrl)).blob();
      setPhoto(new File([blob], 'mug.jpg', { type: 'image/jpeg' }));
    } catch {
      setError('The example photo could not be loaded.');
      return;
    }
    setUsingMug(true);
    setBriefType('product');
    setFolioId('');
    setClientName('Harbour Mugs');
    setProductNoun('mug');
    setAudience('people who work from home');
    setOffer('');
    setFacts('');
    setBrandColours('');
    setChannel('paid_social_square');
  }

  // The other two examples need no photo. Each fills the whole form, so one more click on Generate reaches a finished design.
  function clearForExample(type: BriefType) {
    setError(null);
    setPhoto(null);
    setUsingMug(false);
    setBriefType(type);
    setFolioId('');
    setTitle('');
    setEventDate('');
    setEventPlace('');
    setCta('');
    setProductNoun('');
    setOffer('');
    setFacts('');
    setBrandColours('');
    setChannel('paid_social_square');
  }

  function loadEventExample() {
    clearForExample('event');
    setClientName('Another World Events');
    setTitle('Build for Your World');
    setEventDate('Thu 20 Nov, 7pm');
    setAudience('programmers');
    setBrandColours('blue deep');
  }

  function loadPromoExample() {
    clearForExample('promo');
    setClientName('Cloudline Studio');
    setTitle('Autumn Sale');
    setOffer('20% off all workshops until 30 November');
    setAudience('freelancers who want to learn a new skill');
  }

  const typeReady =
    briefType === 'product' ? !!(productNoun.trim() && photo)
    : briefType === 'event' ? !!(title.trim() && eventDate.trim())
    : !!(title.trim() && offer.trim());
  const canRun = !!(clientName.trim() && audience.trim() && typeReady && hasCode && !running);

  async function start() {
    setError(null);
    let productImageUrl: string | undefined;
    if (briefType === 'product' && photo) {
      try {
        productImageUrl = await prepPhoto(photo);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That photo could not be read. Try a JPEG or PNG.');
        return;
      }
    }
    setRun({
      id: Date.now(), channel, briefType, folioId: folio?.id ?? null, audience: audience.trim(),
      body: {
        briefType,
        clientName: clientName.trim(),
        title: title.trim() || undefined,
        productNoun: briefType === 'product' ? productNoun.trim() : undefined,
        offer: offer.trim() || undefined,
        eventDate: eventDate.trim() || undefined,
        eventPlace: eventPlace.trim() || undefined,
        cta: cta.trim() || undefined,
        audience: audience.trim(),
        facts: folio ? undefined : facts.trim() || undefined,
        brandColours: brandColours.trim() || undefined,
        channel,
        folio: folio ?? undefined,
        productImageUrl,
      },
    });
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'var(--cm-text-primary)', margin: 0 }}>Creative Director</h1>
        <p style={{ fontSize: 13, color: 'var(--cm-text-secondary)', margin: '4px 0 0' }}>
          Give it a short brief for a product ad, an event poster or a promo graphic. Muse Image makes artwork only, the layout engine sets the
          type, and Muse Spark looks at each finished design and critiques it, for two to three rounds. It uses only the facts you give it.
          Pick a folio to enforce its brand rules, or make your own.
        </p>
        {!hasCode && (
          <p role="note" style={{ fontSize: 12, color: 'var(--cm-text-primary)', margin: '10px 0 0', padding: '8px 10px', border: '1px solid var(--cm-border-strong)', borderRadius: 8 }}>
            Enter the demo code at the top right to run the agent.
          </p>
        )}
      </div>

      <div role="group" aria-label="Try an example" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cm-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Try an example</span>
        <button type="button" className="btn-ghost" data-preset="mug" onClick={loadMugExample}>Mug product ad</button>
        <button type="button" className="btn-ghost" data-preset="event" onClick={loadEventExample}>Event poster</button>
        <button type="button" className="btn-ghost" data-preset="promo" onClick={loadPromoExample}>Autumn Sale promo</button>
      </div>

      <div style={{ background: 'var(--cm-surface)', border: '1px solid var(--cm-border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="brief-type">Brief type</label>
            <select id="brief-type" value={briefType} onChange={(e) => setBriefType(e.target.value as BriefType)} style={inputStyle}>
              {BRIEF_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="folio">Folio (optional)</label>
            <select id="folio" value={folioId} onChange={(e) => applyFolio(folios.find((f) => f.id === e.target.value) ?? null)} style={inputStyle}>
              <option value="">No folio</option>
              {folios.map((f) => <option key={f.id} value={f.id}>{f.brand_name}: {f.product_name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <button type="button" onClick={() => setEditing('new')} style={linkButton}>New folio</button>
              {folio && userFolios.some((f) => f.id === folio.id) && <button type="button" onClick={() => setEditing(folio)} style={linkButton}>Edit this folio</button>}
            </div>
          </div>
          <div>
            <label style={labelStyle} htmlFor="channel">Channel</label>
            <select id="channel" value={channel} onChange={(e) => setChannel(e.target.value as CreativeChannel)} style={inputStyle}>
              {CHANNELS.map((c) => <option key={c} value={c} disabled={!allowedChannels.includes(c)}>{CHANNEL_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{briefType === 'event' ? 'Organiser' : 'Client or brand'}</label>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={briefType === 'event' ? 'e.g. Dublin Builders Meetup' : 'e.g. Sparks Audio'} style={inputStyle} />
          </div>
          {briefType === 'product' ? (
            <div>
              <label style={labelStyle}>{PRODUCT_FIELD_LABEL}</label>
              <input value={productNoun} onChange={(e) => setProductNoun(e.target.value)} placeholder={PRODUCT_FIELD_PLACEHOLDER} style={inputStyle} aria-describedby="product-hint" />
              {looksLikeSlogan(productNoun) && (
                <p id="product-hint" style={{ fontSize: 11, color: 'var(--cm-text-secondary)', margin: '6px 0 0', lineHeight: 1.4 }}>{PRODUCT_FIELD_HINT}</p>
              )}
            </div>
          ) : (
            <div>
              <label style={labelStyle}>{briefType === 'event' ? 'Event title' : 'Headline idea'}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={briefType === 'event' ? 'e.g. Build for Your World' : 'e.g. Autumn Sale'} style={inputStyle} />
            </div>
          )}
          {briefType === 'event' && (
            <>
              <div>
                <label style={labelStyle}>Date and time</label>
                <input value={eventDate} onChange={(e) => setEventDate(e.target.value)} placeholder="e.g. Thu 20 Nov, 7pm" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Place (optional)</label>
                <input value={eventPlace} onChange={(e) => setEventPlace(e.target.value)} placeholder="e.g. The Dock, Dublin" style={inputStyle} />
              </div>
            </>
          )}
          <div>
            <label style={labelStyle}>{briefType === 'promo' ? 'The offer or message' : briefType === 'event' ? 'Extra line, such as price (optional)' : 'Offer (optional)'}</label>
            <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder={briefType === 'promo' ? 'e.g. 20% off all workshops until 30 November' : briefType === 'event' ? 'e.g. Free entry' : 'e.g. 20% off this week'} style={inputStyle} />
          </div>
          {briefType !== 'product' && (
            <div>
              <label style={labelStyle}>Call to action (optional)</label>
              <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="e.g. RSVP on the meetup page" style={inputStyle} />
            </div>
          )}
          <div>
            <label style={labelStyle}>Audience</label>
            <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. busy commuters who lose earbuds" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Brand colours (optional)</label>
            <input value={brandColours} onChange={(e) => setBrandColours(e.target.value.slice(0, MAX_BRAND_COLOURS_LENGTH))} placeholder="e.g. navy and gold" maxLength={MAX_BRAND_COLOURS_LENGTH} style={inputStyle} />
          </div>
        </div>

        <label style={labelStyle}>{folio ? 'Approved facts and claims from the folio' : `Facts you can use (optional, ${facts.length}/${MAX_FACTS_LENGTH})`}</label>
        <textarea value={facts} onChange={(e) => setFacts(e.target.value.slice(0, MAX_FACTS_LENGTH))} maxLength={MAX_FACTS_LENGTH} rows={2} readOnly={!!folio}
          placeholder="Only facts listed here, plus the details typed above, may appear in the copy. Nothing else is invented."
          style={{ ...inputStyle, marginBottom: folio ? 4 : 16, resize: 'vertical', fontFamily: 'inherit', opacity: folio ? 0.75 : 1 }} />
        {folio && (
          <p style={{ fontSize: 11, color: 'var(--cm-text-muted)', margin: '0 0 16px' }}>
            With a folio selected, its approved facts and claims are the only facts the agent may use.
          </p>
        )}

        {briefType === 'product' && (
          <>
            <label style={labelStyle} htmlFor="photo">Your product photo</label>
            <input id="photo" type="file" accept="image/*" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setUsingMug(false); }} style={{ ...inputStyle, marginBottom: 6 }} />
            <p style={{ fontSize: 12, margin: '0 0 6px', color: 'var(--cm-text-secondary)' }}>
              {usingMug ? 'Using the bundled mug photo. Choose a file above to use your own.' : <>No photo handy? <button type="button" onClick={loadMugExample} style={linkButton}>Try the mug example</button></>}
            </p>
            <p style={{ fontSize: 11, color: 'var(--cm-text-muted)', margin: '0 0 16px' }}>
              The photo is shrunk in your browser before it is sent, which also removes its location and camera data. Use your own product, not a brand you do not own.
            </p>
          </>
        )}

        <button className="btn-primary" onClick={() => start()} disabled={!canRun}>
          {running ? 'Running…' : briefType === 'product' ? 'Generate ad concepts' : 'Generate designs'}
        </button>
        {running && (
          <p style={{ fontSize: 12, color: 'var(--cm-text-secondary)', margin: '10px 0 0' }}>
            This runs two to three rounds of image generation, checking and critique against the real models and can take a few minutes. Please keep this tab open while it runs.
          </p>
        )}
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, border: '1px solid var(--cm-border-strong)', color: 'var(--cm-text-primary)' }}>{error}</div>
      )}

      {run && (
        <RunStage key={run.id} body={run.body} channel={run.channel} briefType={run.briefType} hasProduct={run.briefType === 'product'}
          feedbackContext={{ productFolioId: run.folioId, audience: run.audience, briefType: run.briefType, channel: run.channel }}
          active={active} onStatusChange={setRunStatus} onRetry={() => setRun({ ...run, id: Date.now() })} />
      )}

      {editing && (
        <FolioEditor
          folio={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            const saved = saveUserFolio(f);
            setUserFolios(loadUserFolios());
            setEditing(null);
            applyFolio(saved);
          }}
          onDelete={editing !== 'new' ? () => {
            deleteUserFolio(editing.id);
            setUserFolios(loadUserFolios());
            setFolioId('');
            setEditing(null);
          } : undefined}
        />
      )}
    </div>
  );
}

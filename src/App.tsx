import { useState } from 'react';
import CreativeDirector from './pages/CreativeDirector';
import Catalogue from './pages/Catalogue';
import { getDemoCode, setDemoCode } from './lib/browser/store';

export default function App() {
  const [code, setCode] = useState(getDemoCode());
  const [tab, setTab] = useState<'single' | 'catalogue'>('single');
  const tabClass = (active: boolean) =>
    `border-b-2 px-3 py-2 text-[13px] font-semibold ${active ? 'border-[var(--cm-accent)] text-[var(--cm-text-primary)]' : 'border-transparent text-[var(--cm-text-secondary)]'}`;
  return (
    <div>
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--cm-border)] px-6 py-3">
        <span className="text-sm font-extrabold tracking-tight text-[var(--cm-text-primary)]">Creative Director Agent</span>
        <span className="text-xs text-[var(--cm-text-muted)]">Built for the Meta Global AI Developer Hackathon</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-[var(--cm-text-secondary)]">
          Demo code
          <input
            type="password"
            autoComplete="off"
            value={code}
            onChange={(e) => { setCode(e.target.value); setDemoCode(e.target.value); }}
            placeholder="Enter the demo code"
            aria-label="Demo code"
            className="w-44 rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg)] px-2 py-1 text-xs text-[var(--cm-text-primary)]"
          />
        </label>
      </header>
      <nav aria-label="Mode" className="flex gap-2 border-b border-[var(--cm-border)] px-6">
        <button type="button" className={tabClass(tab === 'single')} aria-current={tab === 'single'} onClick={() => setTab('single')} data-tab="single">Single ad</button>
        <button type="button" className={tabClass(tab === 'catalogue')} aria-current={tab === 'catalogue'} onClick={() => setTab('catalogue')} data-tab="catalogue">Catalogue</button>
      </nav>
      {/* Both stay mounted so a run in one tab keeps going while you look at the other. */}
      <div hidden={tab !== 'single'}><CreativeDirector hasCode={!!code.trim()} active={tab === 'single'} /></div>
      <div hidden={tab !== 'catalogue'}><Catalogue hasCode={!!code.trim()} active={tab === 'catalogue'} /></div>
    </div>
  );
}

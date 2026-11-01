// A larger view of a photo or an ad: click a thumbnail, see it big, click anywhere or press Escape to close.
import { useEffect, useState } from 'react';

interface ThumbProps {
  src: string;
  alt: string;
  caption: string;
}

/** A thumbnail at least 300 px wide that opens the larger view when clicked. */
export function Thumb({ src, alt, caption }: ThumbProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open a larger view: ${alt}`} data-thumb
        className="cursor-zoom-in rounded-lg border border-[var(--cm-border)] bg-[var(--cm-bg)] p-0">
        <img src={src} alt={alt} className="block w-[300px] max-w-full rounded-lg object-contain" style={{ minWidth: 300 }} />
      </button>
      <span className="text-center text-[10px] uppercase tracking-[0.06em] text-[var(--cm-text-muted)]">{caption}</span>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={alt} data-lightbox onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/80 p-6">
          <img src={src} alt={alt} className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain" />
          <span className="text-xs text-white">{caption}. Click anywhere or press Escape to close.</span>
        </div>
      )}
    </div>
  );
}

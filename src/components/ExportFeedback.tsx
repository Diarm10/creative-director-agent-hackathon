// "Export feedback data": downloads the saved feedback as one JSONL file and says what happened beside the button, in plain words.
// With no feedback saved it downloads nothing and says so.
import { useEffect, useState } from 'react';
import { feedbackFile, type FeedbackExportRow } from '../lib/meta/feedbackExport';
import { listFeedback } from '../lib/browser/store';

export default function ExportFeedback({ className = 'btn-ghost', resetKey }: { className?: string; resetKey?: unknown }) {
  const [message, setMessage] = useState<string | null>(null);
  // A message from earlier goes when the page it sat on is left (resetKey changes).
  useEffect(() => setMessage(null), [resetKey]);

  function exportData() {
    const file = feedbackFile(listFeedback() as FeedbackExportRow[], new Date().toISOString().slice(0, 10));
    if (file.count > 0) {
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/x-ndjson' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
    setMessage(file.message);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={className} onClick={exportData} data-export-feedback>Export feedback data</button>
      {message && <span role="status" className="text-[11px] text-[var(--cm-text-secondary)]" data-export-message>{message}</span>}
    </span>
  );
}

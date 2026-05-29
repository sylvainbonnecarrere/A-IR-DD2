import React from 'react';
import { Button } from './UI';

export const RestoreTraceButton: React.FC = () => {
  const handleExport = async () => {
    try {
      // Read the global trace log populated by WorkflowCanvas
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const log = (window && (window as any).__ARC_RESTORE_LOG__) || [];
      const content = JSON.stringify(log, null, 2);

      // Copy to clipboard if available
      if (navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(content);
          console.info('[RestoreTraceButton] Copied trace to clipboard');
        } catch (e) {
          // ignore clipboard errors
        }
      }

      // Offer a download
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `restore-trace-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Also log to console for QA
      console.info('[RestoreTraceButton] Exported restore trace', log);
      // Provide a minimal UI feedback
      // eslint-disable-next-line no-alert
      alert('Trace exportée. Vérifiez la console ou le presse-papiers.');
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('Échec de l\'export du trace: ' + (err as Error).message);
      console.error(err);
    }
  };

  // Show the button only in dev or when the global log exists
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const hasLog = typeof window !== 'undefined' && !!(window as any).__ARC_RESTORE_LOG__;

  if (!isDev && !hasLog) return null;

  return (
    <Button
      variant="ghost"
      onClick={handleExport}
      className="px-3 py-2 text-xs bg-transparent hover:bg-gray-800 rounded"
      title="Exporter le trace de restauration"
    >
      Exporter trace
    </Button>
  );
};

export default RestoreTraceButton;

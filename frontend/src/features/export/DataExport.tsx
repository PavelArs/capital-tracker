import { type ExportKind, exportApi } from '@api/export.api';
import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'preparing'; what: ExportKind }
  | { kind: 'done'; what: ExportKind; filename: string }
  | { kind: 'failed'; what: ExportKind };

const choices: { what: ExportKind; label: string; hint: string; action: string }[] = [
  {
    what: 'csv',
    label: 'Export CSV',
    hint: 'Assets, accounts, wallets, transactions and their classifications, one CSV file each in a ZIP archive.',
    action: 'Export CSV',
  },
  {
    what: 'backup',
    label: 'Backup',
    hint: 'Everything you recorded in one JSON file. No passwords, 2FA secrets or sessions.',
    action: 'Export backup',
  },
];

/** Hands the file to the browser's downloads. */
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// PR-EXP-1, prototype Settings → Data: the CSV archive (EXP-CSV) and the JSON backup (EXP-JSON).
export default function DataExport() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const run = async (what: ExportKind) => {
    setState({ kind: 'preparing', what });
    try {
      const { blob, filename } = await exportApi.download(what);
      save(blob, filename);
      setState({ kind: 'done', what, filename });
    } catch {
      setState({ kind: 'failed', what });
    }
  };
  return (
    <section className="shell-card" aria-labelledby="settings-data">
      <h2 id="settings-data">Data</h2>
      {choices.map(({ what, label, hint, action }) => {
        const mine = state.kind !== 'idle' && state.what === what;
        return (
          <div className="shell-setting" key={what}>
            <div className="shell-setting__text">
              <span className="shell-setting__label">{label}</span>
              <p className="shell-setting__hint">{hint}</p>
              {mine && state.kind === 'done' && (
                <p className="shell-setting__hint" role="status">
                  Downloaded {state.filename}.
                </p>
              )}
              {mine && state.kind === 'failed' && (
                <p className="shell-setting__hint shell-setting__hint--error" role="alert">
                  Could not export your data; nothing was downloaded. Try again.
                </p>
              )}
            </div>
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={state.kind === 'preparing'}
              onClick={() => void run(what)}
            >
              {mine && state.kind === 'preparing' ? 'Preparing…' : action}
            </button>
          </div>
        );
      })}
    </section>
  );
}

import { type ExportKind, exportApi } from '@api/export.api';
import { useToast } from '@contexts/ToastContext';
import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { SettingRow } from '@/ui/SettingRow';

type State = { kind: 'idle' } | { kind: 'preparing'; what: ExportKind };

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
  const toast = useToast();
  const run = async (what: ExportKind) => {
    setState({ kind: 'preparing', what });
    try {
      const { blob, filename } = await exportApi.download(what);
      save(blob, filename);
      toast.show({ tone: 'success', title: `Downloaded ${filename}.` });
    } catch {
      toast.show({
        tone: 'error',
        title: 'Could not export your data. Nothing was downloaded. Try again.',
      });
    } finally {
      setState({ kind: 'idle' });
    }
  };
  return (
    <Card labelledBy="settings-data">
      <CardHeader id="settings-data" title="Data" />
      {choices.map(({ what, label, hint, action }) => {
        const mine = state.kind === 'preparing' && state.what === what;
        return (
          <SettingRow
            key={what}
            title={label}
            description={hint}
            control={
              <Button
                variant="secondary"
                size="sm"
                disabled={state.kind === 'preparing'}
                onClick={() => void run(what)}
              >
                {mine ? 'Preparing…' : action}
              </Button>
            }
          />
        );
      })}
    </Card>
  );
}

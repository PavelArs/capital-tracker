import { exportApi } from '@api/export.api';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataExport from './DataExport';

// What the browser was asked to save: the anchor's file name and the blob behind its URL.
const saved: { name: string; blob: Blob }[] = [];
const blobs = new Map<string, Blob>();

beforeEach(() => {
  vi.restoreAllMocks();
  saved.length = 0;
  blobs.clear();
  let next = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:test/${++next}`;
      blobs.set(url, blob);
      return url;
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (blob) saved.push({ name: this.download, blob });
  });
});
afterEach(cleanup);

const card = () => screen.getByRole('region', { name: 'Data' });

describe('Settings → Data (EXP-UI)', () => {
  it('offers the CSV archive and the JSON backup', () => {
    render(<DataExport />);
    expect(within(card()).getByText('Export CSV', { selector: 'span' })).toBeInTheDocument();
    expect(
      within(card()).getByText(
        'Assets, accounts, wallets, transactions and their classifications, one CSV file each in a ZIP archive.',
      ),
    ).toBeInTheDocument();
    expect(within(card()).getByText('Backup')).toBeInTheDocument();
    expect(
      within(card()).getByText(
        'Everything you recorded in one JSON file. No passwords, 2FA secrets or sessions.',
      ),
    ).toBeInTheDocument();
  });

  it('EXP-CSV: downloads the archive under the name the server gave', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' });
    let finish: (value: { blob: Blob; filename: string }) => void = () => {};
    const download = vi
      .spyOn(exportApi, 'download')
      .mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DataExport />);
    await userEvent.click(within(card()).getByRole('button', { name: 'Export CSV' }));
    expect(download).toHaveBeenCalledWith('csv');
    const busy = within(card()).getByRole('button', { name: 'Preparing…' });
    expect(busy).toBeDisabled();
    finish({ blob, filename: 'capital-tracker-export-2026-10-08.zip' });
    expect(
      await within(card()).findByText('Downloaded capital-tracker-export-2026-10-08.zip.'),
    ).toBeInTheDocument();
    expect(saved).toEqual([{ name: 'capital-tracker-export-2026-10-08.zip', blob }]);
    expect(within(card()).getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('EXP-JSON: downloads the backup', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    const download = vi
      .spyOn(exportApi, 'download')
      .mockResolvedValue({ blob, filename: 'capital-tracker-backup-2026-10-08.json' });
    render(<DataExport />);
    await userEvent.click(within(card()).getByRole('button', { name: 'Export backup' }));
    expect(download).toHaveBeenCalledWith('backup');
    expect(
      await within(card()).findByText('Downloaded capital-tracker-backup-2026-10-08.json.'),
    ).toBeInTheDocument();
    expect(saved).toEqual([{ name: 'capital-tracker-backup-2026-10-08.json', blob }]);
  });

  it('says so when an export fails and lets the owner try again', async () => {
    vi.spyOn(exportApi, 'download').mockRejectedValueOnce(new Error('offline'));
    render(<DataExport />);
    await userEvent.click(within(card()).getByRole('button', { name: 'Export backup' }));
    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      'Could not export your data; nothing was downloaded. Try again.',
    );
    expect(saved).toEqual([]);
    expect(within(card()).getByRole('button', { name: 'Export backup' })).toBeEnabled();
  });
});

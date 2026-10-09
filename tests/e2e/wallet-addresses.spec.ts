import { createHash, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { providerRequests } from './manual-opening-fixtures';
import { compose, loginWithMfa, origin, query, test } from './mfa-fixtures';

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const foreignAddressId = '44444444-4444-4444-8444-444444444444';
const txid = (i: number) => createHash('sha256').update(`ct-e2e-tx:${address}:${i}`).digest('hex');
// The shared stub keeps requests from earlier acceptance steps, so count only this test's requests.
let requestBaseline = 0;
const chainRequests = () =>
  providerRequests()
    .slice(requestBaseline)
    .filter(({ url }) => url.startsWith('https://blockstream.info/api/address/'));

function bitcoinHistory(body: Record<string, unknown>): void {
  compose([
    'exec',
    '-T',
    'providers',
    'node',
    '-e',
    `fetch('http://127.0.0.1:8080/__control/bitcoin-history', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })
      .then((response) => { if (!response.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; });`,
  ]);
}

const isolated = test.extend<{ isolatedWalletAddresses: undefined }>({
  isolatedWalletAddresses: [
    async ({ mfa }, use) => {
      expect(mfa).toBeDefined();
      query(`DO $$ BEGIN
        IF current_database() <> 'capital_tracker_e2e' OR current_user <> 'capital_e2e' THEN
          RAISE EXCEPTION 'Refuse wallet-address fixture outside synthetic acceptance';
        END IF;
        TRUNCATE chain_transaction_classification_versions, chain_transaction_classifications,
          wallet_stake_rewards, wallet_stake_moves, wallet_stake_accounts, wallet_stake_scans, wallet_xpub_addresses,
          wallet_ether_stake_rewards, wallet_ether_stake_moves, wallet_ether_stake_positions, bybit_accounts,
          wallet_tron_stake_moves, wallet_tron_accounts, wallet_stellar_accounts,
          wallet_address_transactions, wallet_addresses;
        INSERT INTO wallet_addresses(id, "ownerId", network, address)
          VALUES ('${foreignAddressId}', '22222222-2222-4222-8222-222222222222', 'bitcoin', '${address}');
      END $$`);
      requestBaseline = providerRequests().length;
      await use(undefined);
    },
    { auto: true },
  ],
});

isolated(
  'ADDR-API / ADDR-PRIVATE: owner imports Bitcoin history and every USD value stays missing',
  async ({ page, playwright }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      expect((await anonymous.get('/api/wallet-addresses')).status()).toBe(401);
      expect(
        (
          await anonymous.post('/api/wallet-addresses', {
            data: { address },
            headers: { Origin: origin },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }

    const { csrfToken } = await loginWithMfa(page);
    const api = page.context().request;
    const missingCsrf = await api.post('/api/wallet-addresses', {
      data: { address },
      headers: { Origin: origin },
    });
    expect(missingCsrf.status()).toBe(403);
    const foreign = await api.post(`/api/wallet-addresses/${foreignAddressId}/sync`, {
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
    });
    expect(foreign.status()).toBe(404);
    expect((await api.get(`/api/wallet-addresses/${foreignAddressId}/transactions`)).status()).toBe(404);
    expect((await api.get(`/api/wallet-addresses/${randomUUID()}/transactions`)).status()).toBe(404);
    expect(query('SELECT count(*) FROM wallet_addresses')).toBe('1');
    expect(chainRequests()).toEqual([]);

    // The legacy address screen is retired (M20); WAL-UI drives the Wallets screen, and the
    // same import is asserted here through the API the screens use.
    bitcoinHistory({ address, count: 60 });
    const headers = { Origin: origin, 'X-CSRF-Token': csrfToken };
    const created = await api.post('/api/wallet-addresses', {
      data: { network: 'bitcoin', address: address.toUpperCase() },
      headers,
    });
    expect(created.status()).toBe(201);
    const added = await created.json();
    expect(added).toMatchObject({ network: 'bitcoin', address, transactionCount: 0 });
    expect(added.sync.state).toBe('never');
    expect(chainRequests()).toEqual([]);

    const synced = await api.post(`/api/wallet-addresses/${added.id}/sync`, { headers });
    expect(synced.status()).toBe(200);
    expect(await synced.json()).toMatchObject({
      outcome: 'complete',
      reason: null,
      imported: 60,
      address: { id: added.id, transactionCount: 60, sync: { state: 'complete' } },
    });
    expect(chainRequests().map(({ url }) => url)).toEqual([
      `https://blockstream.info/api/address/${address}/txs/chain`,
      `https://blockstream.info/api/address/${address}/txs/chain/${txid(35)}`,
      `https://blockstream.info/api/address/${address}/txs/chain/${txid(10)}`,
    ]);

    type HistoryPage = {
      total: number;
      nextOffset: number | null;
      missingUsdValueCount: number;
      items: { direction: string; netBtc: string; blockTime: string; usdValue: unknown }[];
    };
    const history = async (offset: number): Promise<HistoryPage> => {
      const response = await api.get(
        `/api/wallet-addresses/${added.id}/transactions?offset=${offset}&limit=50`,
      );
      expect(response.status()).toBe(200);
      return response.json();
    };
    const assertHistory = async () => {
      const first = await history(0);
      expect(first).toMatchObject({ total: 60, nextOffset: 50, missingUsdValueCount: 60 });
      expect(first.items).toHaveLength(50);
      expect(first.items.slice(0, 4).map(({ direction, netBtc }) => [direction, netBtc])).toEqual([
        ['in', '3.12500059'],
        ['self', '-0.00000200'],
        ['out', '-0.00051300'],
        ['in', '0.00156000'],
      ]);
      expect(first.items[0].blockTime.slice(0, 10)).toBe('2023-11-15');
      const rest = await history(50);
      expect(rest).toMatchObject({ total: 60, nextOffset: null, missingUsdValueCount: 60 });
      expect(rest.items).toHaveLength(10);
      // Every USD value is missing, never zero.
      for (const item of [...first.items, ...rest.items]) {
        expect(item).toMatchObject({ usdValue: null, usdValueStatus: 'missing' });
      }
    };
    await assertHistory();

    const before = chainRequests().length;
    await page.reload();
    await assertHistory();
    expect(chainRequests()).toHaveLength(before);
    expect(
      query(`SELECT count(*) FROM wallet_address_transactions t JOIN wallet_addresses a ON a.id = t."addressId"
        WHERE a."ownerId" = '11111111-1111-4111-8111-111111111111'`),
    ).toBe('60');
    expect(
      query(`SELECT count(*) FROM wallet_address_transactions WHERE "addressId" = '${foreignAddressId}'`),
    ).toBe('0');
  },
);

const ownerId = '11111111-1111-4111-8111-111111111111';
const seedPhrase = `${'abandon '.repeat(11)}about`;

async function fitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

isolated(
  'WAL-UI / WAL-NO-SECRETS / SYNC-STATUS: owner adds a Bitcoin address to a new wallet, sees its chain balance against recorded transactions and a failed sync with its reason',
  async ({ page }, testInfo) => {
    await loginWithMfa(page);
    const walletName = `WAL-UI ${randomUUID().slice(0, 8)}`;
    // Every request body the page sends, to prove a pasted seed phrase never leaves the browser.
    const bodies: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/'))
        bodies.push(request.postData() ?? '');
    });
    bitcoinHistory({ address, count: 60 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/wallets');
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { level: 1, name: 'Wallets', exact: true }),
    ).toBeVisible();
    await expect(main.getByText(/not built yet/i)).toHaveCount(0);

    await main.getByRole('button', { name: 'Add wallet', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add wallet' });
    await dialog.getByRole('button', { name: /^Bitcoin/ }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    const field = dialog.getByLabel('Bitcoin wallet address', { exact: true });
    await field.fill(seedPhrase);
    await expect(dialog.getByRole('alert')).toContainText('This looks like a seed phrase');
    await expect(field).toHaveValue('');
    await field.fill('0x3B9e4f8A2c71D05e6aF1b2C9d8E07a4F5c6D8F31');
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dialog.getByText(/This looks like an Ethereum address/)).toBeVisible();
    await expect(dialog.getByText('Step 2 of 3', { exact: true })).toBeVisible();

    await field.fill(address);
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await dialog.getByLabel(/^Wallet/).fill(walletName);
    await expect(
      dialog.getByText(`A new wallet named ${walletName} is created.`, {
        exact: false,
      }),
    ).toBeVisible();
    await dialog.getByLabel(/^Address name/).fill('Savings');
    await dialog.getByRole('button', { name: 'Add wallet', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // The page loads the whole history, then compares it with the wallet's transactions.
    const card = main.getByRole('region', { name: walletName, exact: true });
    const row = card.getByRole('button', {
      name: `Savings ${address}`,
      exact: true,
    });
    await expect(row).toContainText('Synced');
    await expect(row).toContainText('46.88647965 BTC');
    await expect(card.getByText('Bitcoin · 1 address', { exact: true })).toBeVisible();
    // CLS-PROVISIONAL: the unclassified history already counts, so the wallet holds what the
    // chain shows and no difference is reported.
    const walletBitcoin = async () => {
      const portfolio = (await (await page.request.get('/api/accounting/portfolio')).json()) as {
        assets: {
          symbol: string | null;
          holdings: { accountName: string; quantity: string }[];
        }[];
      };
      return portfolio.assets
        .filter((asset) => asset.symbol === 'BTC')
        .flatMap((asset) => asset.holdings)
        .filter((holding) => holding.accountName === walletName)
        .map((holding) => holding.quantity);
    };
    await expect.poll(walletBitcoin).toEqual(['46.88647965']);
    await expect(card.getByRole('note')).toHaveCount(0);
    expect(
      query(`SELECT a.name || '|' || w.label FROM wallet_addresses w
        JOIN manual_accounts a ON a.id = w."accountId" AND a."ownerId" = w."ownerId"
        WHERE w."ownerId" = '${ownerId}' AND w.address = '${address}'`),
    ).toBe(`${walletName}|Savings`);
    expect(
      query(`SELECT count(*) FROM wallet_address_transactions t JOIN wallet_addresses a ON a.id = t."addressId"
        WHERE a."ownerId" = '${ownerId}'`),
    ).toBe('60');
    await fitsViewport(page);
    await page.screenshot({
      path: testInfo.outputPath('wallets-1440.png'),
      fullPage: true,
    });

    // WAL-DUP: the same address again opens the wallet that already tracks it.
    await main.getByRole('button', { name: 'Add wallet', exact: true }).first().click();
    await dialog.getByRole('button', { name: /^Bitcoin/ }).click();
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
    await field.fill(address);
    await expect(
      dialog.getByText(`This address is already tracked in ${walletName}.`),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Open it', exact: true }).click();
    const drawer = page.getByRole('dialog', {
      name: `${walletName} · Bitcoin`,
      exact: true,
    });
    await expect(drawer).toContainText('46.88647965 BTC');
    await expect(drawer).toContainText('Blockstream Esplora');
    await expect(drawer.getByRole('link', { name: 'All in Transactions' })).toBeVisible();
    await drawer.getByLabel(/^Address name/).fill('Cold');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer.getByRole('status')).toHaveText('Saved.');
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(card.getByRole('button', { name: `Cold ${address}`, exact: true })).toBeVisible();
    expect(
      query(
        `SELECT label FROM wallet_addresses WHERE "ownerId" = '${ownerId}' AND address = '${address}'`,
      ),
    ).toBe('Cold');
    expect(query('SELECT count(*) FROM wallet_addresses')).toBe('2');

    // Phones get two-line rows and no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card.getByRole('button', { name: `Cold ${address}`, exact: true })).toContainText(
      '46.88647965 BTC',
    );
    await fitsViewport(page);
    await page.screenshot({
      path: testInfo.outputPath('wallets-390.png'),
      fullPage: true,
    });
    expect(bodies.join('\n')).not.toContain('abandon');

    // SYNC-STATUS: prices synced 12 minutes ago and this wallet's next sync fails. The failure
    // is stored, so it is still there after a reload, with the sidebar's last good sync.
    query(`DO $$ BEGIN
      IF current_database() <> 'capital_tracker_e2e' OR current_user <> 'capital_e2e' THEN
        RAISE EXCEPTION 'Refuse sync-status fixture outside synthetic acceptance';
      END IF;
      INSERT INTO sync_sources (key, state, "lastAttemptAt", "lastSuccessAt", "nextRunAt")
        VALUES ('prices:kraken', 'synced', now() - interval '12 minutes', now() - interval '12 minutes',
          now() + interval '1 hour')
        ON CONFLICT (key) DO UPDATE SET state = 'synced', "lastAttemptAt" = EXCLUDED."lastAttemptAt",
          "lastSuccessAt" = EXCLUDED."lastSuccessAt", "nextRunAt" = EXCLUDED."nextRunAt",
          "errorCode" = NULL, "errorMessage" = NULL;
    END $$`);
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      bitcoinHistory({ address, count: 60, fault: { onRequest: 1, status: 503 } });
      await card.getByRole('button', { name: `Cold ${address}`, exact: true }).click();
      const coldDrawer = page.getByRole('dialog', { name: `${walletName} · Bitcoin`, exact: true });
      await coldDrawer.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect(coldDrawer.getByRole('alert')).toContainText(
        'Bitcoin data is temporarily unavailable.',
      );
      await coldDrawer.getByRole('button', { name: 'Close', exact: true }).click();
      await page.reload();
      const failedRow = card.getByRole('button', { name: `Cold ${address}`, exact: true });
      await expect(failedRow).toContainText('Sync failed');
      await expect(failedRow).toContainText('46.88647965 BTC');
      await expect(
        card.getByText(
          /^Bitcoin data is temporarily unavailable\. Balances shown are from (just now|\d+ min ago)\.$/,
        ),
      ).toBeVisible();
      await expect(card.getByRole('button', { name: 'Retry now', exact: true })).toBeVisible();
      const status = page
        .getByRole('navigation', { name: 'Main navigation' })
        .locator('[data-sync-status]');
      await expect(status).toContainText('1 source needs attention');
      await expect(status).toContainText('Others synced 12 min ago');
      await expect(status).toHaveAttribute('href', '/wallets');
      expect(
        query(`SELECT state || '|' || "errorMessage" FROM sync_sources s JOIN wallet_addresses a
          ON s.key = 'wallet:' || a.id::text WHERE a."ownerId" = '${ownerId}' AND a.address = '${address}'`),
      ).toBe('failed|Bitcoin data is temporarily unavailable.');
      await page.screenshot({
        path: testInfo.outputPath('wallets-sync-failed-1440.png'),
        fullPage: true,
      });
    } finally {
      query(`DELETE FROM sync_sources WHERE key = 'prices:kraken'`);
    }

    // A hidden transaction leaves the books, so the wallet now differs from the chain by it.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/transactions?status=needs-classification');
    await main.getByRole('combobox', { name: 'Account', exact: true }).selectOption({
      label: walletName,
    });
    await main
      .getByRole('table', { name: 'Transactions', exact: true })
      .locator('tbody tr:not(.transactions-day)')
      .first()
      .getByRole('button', { name: /^(Incoming|Outgoing)$/ })
      .click();
    const hide = page.getByRole('dialog', { name: /transaction · BTC$/ });
    await hide.getByText('More options').click();
    await hide.getByText('Hide from calculations').click();
    await hide.getByRole('button', { name: 'Save' }).click();
    await expect.poll(walletBitcoin).not.toEqual(['46.88647965']);
    await page.keyboard.press('Escape');
    await page.goto('/wallets');

    // WAL-PAGE: the wallet's own page lists its address, assets and chain transactions.
    await card.getByRole('link', { name: walletName, exact: true }).click();
    await expect(page).toHaveURL(/\/wallets\/[0-9a-f-]{36}$/);
    await expect(
      main.getByRole('heading', { level: 2, name: walletName, exact: true }),
    ).toBeVisible();
    // The chain check spans the summary under its figures; Last sync starts under its label.
    const summary = main.getByRole('region', { name: 'Summary', exact: true });
    await expect(summary.getByRole('note')).toContainText(
      /Balance differs by [\d.]+ BTC\. The blockchain shows 46\.88647965 BTC;/,
    );
    const misplaced = await summary.evaluate((card) => {
      const box = (element: Element | null) => element?.getBoundingClientRect();
      const grid = box(card.querySelector('dl'));
      const note = box(card.querySelector('[role="note"]'));
      const last = [...card.querySelectorAll('dt')].find((dt) => dt.textContent === 'Last sync');
      const label = box(last ?? null);
      const status = box(last?.nextElementSibling?.querySelector('.wallets-badge') ?? null);
      if (!grid || !note || !label || !status) return ['missing summary parts'];
      return [
        Math.abs(note.left - grid.left) > 1 && `note left ${note.left} vs ${grid.left}`,
        Math.abs(note.right - grid.right) > 1 && `note right ${note.right} vs ${grid.right}`,
        note.top - grid.bottom < 12 && `note gap ${note.top - grid.bottom}px`,
        Math.abs(status.left - label.left) > 1 && `status left ${status.left} vs ${label.left}`,
      ].filter(Boolean);
    });
    expect(misplaced).toEqual([]);
    const walletAddresses = main.getByRole('region', {
      name: 'Addresses',
      exact: true,
    });
    await expect(
      walletAddresses.getByRole('button', {
        name: `Cold ${address}`,
        exact: true,
      }),
    ).toContainText('46.88647965 BTC');
    const walletTransactions = main.getByRole('region', {
      name: /^Transactions/,
    });
    await expect(walletTransactions.getByText('Needs classification').first()).toBeVisible();
    await expect(walletTransactions.getByRole('link', { name: /^Show all \d+$/ })).toBeVisible();

    // WAL-RENAME: only the name changes; the address stays in the wallet.
    const renamed = `${walletName} renamed`;
    await main.getByRole('button', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename wallet' });
    await rename.getByLabel('Name', { exact: true }).fill(`  ${renamed} `);
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rename).toHaveCount(0);
    await expect(main.getByRole('heading', { level: 2, name: renamed, exact: true })).toBeVisible();
    expect(
      query(`SELECT a.name FROM wallet_addresses w
        JOIN manual_accounts a ON a.id = w."accountId" AND a."ownerId" = w."ownerId"
        WHERE w."ownerId" = '${ownerId}' AND w.address = '${address}'`),
    ).toBe(renamed);
    await page.screenshot({
      path: testInfo.outputPath('wallet-1440.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await fitsViewport(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // WAL-ACCOUNT: in Transactions the chain rows name the wallet and the address.
    await walletTransactions.getByRole('link', { name: /^Show all \d+$/ }).click();
    await expect(page).toHaveURL(/\/transactions\?account=[0-9a-f-]{36}$/);
    await expect(main.getByText(`${renamed} · Cold`).first()).toBeVisible();
  },
);

import { createHash, randomUUID } from 'node:crypto';
import { expect, type Locator } from '@playwright/test';
import { compose, origin, query, test } from './mfa-fixtures';
import { tradeApi } from './usd-trades-fixtures';

// All names, amounts and both addresses are synthetic (valid bech32 of hashed labels); no other
// case uses them. The shared acceptance database holds other cases' rows too, so this case
// filters by its own wallets.
const senderAddress = 'bc1qyghvm6xchm20kyjv3cwah05sel7y953mxac2ps';
const receiverAddress = 'bc1qyxmjxx2hw7939rg9cu0h7pl2zxky4e3ga9nxuz';
const txid = (name: string) => createHash('sha256').update(`ct-e2e-xfer-ui:${name}`).digest('hex');
const [funding, transfer, payout] = ['funding', 'transfer', 'payout'].map(txid);

type ListedOperation = {
  type: string | null;
  quantity: string;
  status: string;
  account: { id: string } | null;
  counterAccount: { id: string } | null;
  chain: { txid: string } | null;
  classification: { automatic: boolean } | null;
};

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
// The raw row a sync would store for one address: satoshis received, sent and the fee.
function raw(
  addressId: string,
  hash: string,
  direction: 'in' | 'out',
  received: number,
  sent: number,
  fee: number,
  blockTime: string,
): void {
  for (const value of [addressId, hash, blockTime]) expect(value).toMatch(/^[0-9a-fTZ:.-]+$/);
  query(`INSERT INTO wallet_address_transactions("ownerId","addressId",txid,"blockHeight","blockHash",
      "blockTime","receivedUnits","sentUnits","feeUnits",direction,raw)
    SELECT w."ownerId", w.id, '${hash}', 900000, '${txid(`block:${hash}`)}', '${blockTime}',
      ${received}, ${sent}, ${fee}, '${direction}', jsonb_build_object('txid', '${hash}')
    FROM wallet_addresses w WHERE w.id='${addressId}'`);
}
const cells = (row: Locator) => row.getByRole('cell');
const fact = (drawer: Locator, label: string) =>
  drawer.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');

test('XFER-UI: a send between two own wallets is one automatic transfer, and a send to the exchange is linked by hand', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });

  const api = await tradeApi(page);
  const headers = { Origin: origin, 'X-CSRF-Token': api.csrfToken };
  const suffix = randomUUID().slice(0, 8);
  const [senderName, receiverName, exchangeName] = ['Hot', 'Cold', 'Exchange'].map(
    (name) => `XFER-UI ${name} ${suffix}`,
  );
  const sender = await api.account(senderName);
  const receiver = await api.account(receiverName);
  const exchange = await api.account(exchangeName);
  const register = async (address: string, accountId: string) => {
    // No synced history: this case stores the raw rows itself.
    bitcoinHistory({ address, count: 0 });
    const response = await api.request.post('/api/wallet-addresses', {
      data: { address, accountId },
      headers,
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const a = await register(senderAddress, sender.id);
  const b = await register(receiverAddress, receiver.id);
  // The sender receives 0.01 BTC, then sends 0.006 BTC to the receiver with 0.00399 BTC change
  // and a 0.00001 BTC fee, then 0.001 BTC to an address nobody registered (fee 0.00001).
  raw(a, funding, 'in', 1_000_000, 0, 500, '2026-09-01T09:00:00.000Z');
  raw(a, transfer, 'out', 399_000, 1_000_000, 1_000, '2026-09-02T10:00:00.000Z');
  raw(b, transfer, 'in', 600_000, 0, 1_000, '2026-09-02T10:00:00.000Z');
  raw(a, payout, 'out', 298_000, 399_000, 1_000, '2026-09-03T11:00:00.000Z');
  const mine = async () =>
    ((await api.result('GET', '/operations', 200)) as { operations: ListedOperation[] }).operations
      .filter((operation) => [funding, transfer, payout].includes(operation.chain?.txid ?? ''))
      .map((operation) => [
        operation.chain?.txid,
        operation.type,
        operation.status,
        operation.counterAccount?.id ?? null,
        operation.classification?.automatic ?? null,
      ]);
  // Until the funding receipt is recorded the sender held nothing to send, so nothing links.
  // Each leg of the shared transaction suggests the other wallet; their order is the ids'.
  const unlinked = await mine();
  expect(unlinked).toHaveLength(4);
  expect(unlinked[0]).toEqual([payout, null, 'needs-classification', null, null]);
  expect(unlinked.slice(1, 3)).toEqual(
    expect.arrayContaining([
      [transfer, null, 'needs-classification', receiver.id, null],
      [transfer, null, 'needs-classification', sender.id, null],
    ]),
  );
  expect(unlinked[3]).toEqual([funding, null, 'needs-classification', null, null]);

  // XFER-AUTO: classifying the funding receipt lets the app record the transfer without asking.
  await api.result('POST', `/chain-transactions/${a}/${funding}/classifications`, 201, {
    requestId: randomUUID(),
    expectedVersion: 0,
    hidden: false,
    classification: { type: 'buy', currency: 'USD', amount: '600' },
  });
  expect(await mine()).toEqual([
    [payout, null, 'needs-classification', null, null],
    [transfer, 'transfer', 'recorded', receiver.id, true],
    [funding, 'buy', 'recorded', null, false],
  ]);
  const basis = async (accountId: string) =>
    Number(
      (
        (await api.result('GET', `/accounts/${accountId}/trade-journal`, 200)) as {
          journal: { summary: { remainingCostUsd: string } };
        }
      ).journal.summary.remainingCostUsd,
    );
  // XFER-CAPITAL: the receiver's 0.006 BTC keep the sender's 60000 USD per BTC.
  expect(await basis(receiver.id)).toBe(360);

  await page.goto('/transactions');
  const main = page.getByRole('main');
  const table = main.getByRole('table', { name: 'Transactions', exact: true });
  const rows = table.locator('tbody tr:not(.transactions-day)');
  await main.getByRole('combobox', { name: 'Account', exact: true }).selectOption({
    label: senderName,
  });
  await expect(rows).toHaveCount(3);
  await expect(cells(rows.nth(1))).toHaveText([
    'Transfer10:00',
    'BTC',
    '0.006',
    /^(≈ \$[\d,]+\.\d{2}|—)$/,
    `${senderName} → ${receiverName}`,
    'Auto: own walletsBlockchain',
  ]);
  await expect(cells(rows.nth(2))).toHaveText([
    'Buy09:00',
    'BTC',
    '+0.01',
    '$600.00',
    new RegExp(`^${senderName}`),
    'RecordedBlockchain',
  ]);
  await page.screenshot({ path: testInfo.outputPath('transfer-list-1440-dark.png') });

  await rows.nth(1).getByRole('button', { name: 'Transfer' }).click();
  const moved = page.getByRole('dialog', { name: 'Transfer · BTC' });
  await expect(moved.getByRole('note')).toHaveText(
    `Recognised automatically: both addresses belong to your wallets and ${receiverName} received the same amount minus the network fee. Counts as a transfer, not a sale or a deposit.`,
  );
  await expect(fact(moved, 'From')).toHaveText(senderName);
  await expect(fact(moved, 'To')).toHaveText(receiverName);
  await expect(fact(moved, 'Other address')).toHaveText(receiverAddress);
  await expect(fact(moved, 'Network fee')).toHaveText('0.00001 BTC');
  await page.screenshot({ path: testInfo.outputPath('transfer-drawer-1440-dark.png') });
  await page.keyboard.press('Escape');

  // XFER-MANUAL: the payout went to the exchange's deposit address; it is linked by hand.
  await rows.nth(0).getByRole('button', { name: 'Outgoing' }).click();
  const payment = page.getByRole('dialog', { name: 'Outgoing transaction · BTC' });
  const question = payment.getByRole('group', { name: 'What was this transaction?' });
  await expect(question.getByRole('button')).toHaveText([
    'Transfer between my wallets',
    'Sell',
    'Swap',
    'Expense',
    'Gift sent',
    'Fee',
    'Other',
  ]);
  await question.getByRole('button', { name: 'Transfer between my wallets' }).click();
  await expect(
    payment.getByText(
      "Transfers between your wallets don't change your capital. Only the network fee of 0.00001 BTC is counted as a cost.",
    ),
  ).toBeVisible();
  const sentTo = payment.getByLabel('Sent to');
  await expect(sentTo.locator('option', { hasText: exchangeName })).toHaveCount(1);
  await expect(sentTo.locator('option', { hasText: senderName })).toHaveCount(0);
  await sentTo.selectOption({ label: exchangeName });
  await page.screenshot({ path: testInfo.outputPath('transfer-manual-1440-dark.png') });
  await payment.getByRole('button', { name: 'Save' }).click();
  await expect(payment).toHaveCount(0);
  await expect(
    main.getByText(
      /^(Saved as Transfer\. Nothing else to classify here\.|All transactions classified\. The last one was saved as Transfer\.)$/,
    ),
  ).toBeVisible();
  await expect(cells(rows.nth(0))).toHaveText([
    'Transfer11:00',
    'BTC',
    '0.001',
    /^(≈ \$[\d,]+\.\d{2}|—)$/,
    `${senderName} → ${exchangeName}`,
    'RecordedBlockchain',
  ]);
  // The exchange now holds 0.001 BTC at its cost; nothing was recorded as a deposit.
  expect(await basis(exchange.id)).toBe(60);
  expect(await mine()).toEqual([
    [payout, 'transfer', 'recorded', exchange.id, false],
    [transfer, 'transfer', 'recorded', receiver.id, true],
    [funding, 'buy', 'recorded', null, false],
  ]);

  // Phones: the same rows as two-line items, without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  const phoneList = main.getByRole('list', { name: 'Transactions', exact: true });
  await expect(phoneList.getByRole('button')).toHaveCount(3);
  await expect(phoneList.getByRole('button').nth(1)).toContainText(
    `${senderName} → ${receiverName}`,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('transfer-list-390-dark.png') });
  expect(errors).toEqual([]);
});

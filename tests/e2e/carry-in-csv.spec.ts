import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
} from './admission-fixtures';
import {
  command,
  coverageFrom,
  fixture,
  initialSummary,
  retainedRows,
  soldSummary,
} from './carry-in-fixtures';
import {
  buy,
  csvSource,
  csvTables,
  expectJournalSummary,
  inspectAndMap,
  previewInBrowser,
  provenanceInBrowser,
  readCsvReceipt,
  uploadInBrowser,
} from './csv-import-fixtures';
import { openingInput, providerRequests, rows } from './manual-opening-fixtures';
import { fingerprint, test } from './mfa-fixtures';
import { browserPost, trackBrowserRequests, tradeInput } from './usd-trades-fixtures';

test('CARRY-004-A: real manual and browser CSV sales agree250/100; correction, rollback and original receipts retain immutable baseline and bytes', async ({
  page,
}) => {
  const data = await fixture(page);
  const { api, account, instrument, path } = data;
  const initialCommand = command(data);
  const origin = await api.result('POST', path, 201, initialCommand);
  const baseline = await api.result('GET', `${path}/lots`, 200);
  const manual = await api.account();
  const manualOpening = openingInput(instrument.id, {
    asOf: coverageFrom,
    positions: [
      { instrumentId: instrument.id, quantity: '2', costStatus: 'known', totalCostUsd: '300' },
    ],
  });
  await api.save(manual.id, manualOpening);
  const manualPath = `/accounts/${manual.id}/trade-journal/carry-in`;
  const manualCommand = command(data);
  const manualOrigin = await api.result('POST', manualPath, 201, manualCommand);
  const saleInput = tradeInput(instrument.id, 0, {
    side: 'sell',
    quantity: '1.5',
    grossUsd: '450',
    feeUsd: '0',
  });
  const sale = await api.create(manual.id, saleInput);
  expect(await api.result('GET', `/accounts/${manual.id}/trade-journal`, 200)).toMatchObject({
    journal: { summary: soldSummary, journalRevision: 1 },
  });
  const correction = tradeInput(instrument.id, 1, {
    side: 'sell',
    quantity: '1.5',
    grossUsd: '430',
    feeUsd: '0',
  });
  await api.correct(manual.id, sale.trade.tradeId, correction);
  expect(await api.result('GET', `/accounts/${manual.id}/trade-journal`, 200)).toMatchObject({
    journal: {
      summary: { ...soldSummary, grossSalesUsd: '430', netSalesUsd: '430', realizedUsd: '230' },
      journalRevision: 2,
    },
  });
  const manualBeforeReplay = fingerprint(['auth_sessions', 'auth_request_limits']);
  expect(await api.create(manual.id, saleInput, 200)).toEqual(sale);
  expect(await api.result('POST', manualPath, 200, manualCommand)).toEqual(manualOrigin);
  expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(manualBeforeReplay);

  const prior = retainedRows(account.id, [], csvTables);
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  const executions = [{ ...buy, side: 'sell' as const, quantity: '1.5', gross: '450' }];
  try {
    await page.goto(`/manual-accounts/${account.id}`);
    await expectJournalSummary(page, initialSummary);
    const batch = await uploadInBrowser(
      page,
      account.id,
      executions,
      'Продажа из начальных лотов.csv',
    );
    await inspectAndMap(page, account.id, batch, instrument.id, executions);
    const beforePreview = fingerprint(['auth_sessions', 'auth_request_limits']);
    await previewInBrowser(page, account.id, batch, soldSummary);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(beforePreview);
    const batchPath = `/accounts/${account.id}/csv-imports/${batch}`;
    const confirmed = await browserPost(page, `${batchPath}/confirm`, () =>
      page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true }).click(),
    );
    expect(confirmed.status()).toBe(201);
    const confirmCommand = confirmed.request().postDataJSON();
    const receipt = readCsvReceipt(await confirmed.json());
    expect(receipt).toMatchObject({
      kind: 'confirm',
      rowCount: 1,
      firstJournalRevision: 1,
      lastJournalRevision: 1,
    });
    await expectJournalSummary(page, soldSummary);
    const imported = await provenanceInBrowser(page, account.id, batch);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      ordinal: 1,
      startLine: 2,
      rollbackVersion: null,
      createVersion: { side: 'sell', quantity: '1.5', grossUsd: '450' },
    });
    const matches = await api.result(
      'GET',
      `/accounts/${account.id}/trades/${imported[0].tradeId}/matches`,
      200,
    );
    expect(matches).toMatchObject({
      journalRevision: 1,
      items: [
        { sourceKind: 'carry-in', openingRevision: 1, ordinal: 1, quantity: '1', costUsd: '100' },
        { sourceKind: 'carry-in', openingRevision: 1, ordinal: 2, quantity: '0.5', costUsd: '100' },
      ],
      nextOffset: null,
    });
    await page
      .getByRole('checkbox', { name: 'Я проверил последствия отката всей партии', exact: true })
      .check();
    const rolledBack = await browserPost(page, `${batchPath}/rollback`, () =>
      page.getByRole('button', { name: 'Откатить партию CSV', exact: true }).click(),
    );
    expect(rolledBack.status()).toBe(201);
    const rollbackCommand = rolledBack.request().postDataJSON();
    const rollback = readCsvReceipt(await rolledBack.json());
    expect(rollback).toMatchObject({
      kind: 'rollback',
      rowCount: 1,
      firstJournalRevision: 2,
      lastJournalRevision: 2,
    });
    await expectJournalSummary(page, initialSummary);
    expect(await api.result('GET', `${path}/lots`, 200)).toEqual(baseline);
    const afterRollback = fingerprint(['auth_sessions', 'auth_request_limits']);
    expect(await api.result('POST', `${batchPath}/confirm`, 200, confirmCommand)).toEqual(receipt);
    expect(await api.result('POST', `${batchPath}/rollback`, 200, rollbackCommand)).toEqual(
      rollback,
    );
    expect(await api.result('POST', path, 200, initialCommand)).toEqual(origin);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(afterRollback);
    expect(
      rows(
        `SELECT encode("originalBytes",'hex') AS bytes,filename,state FROM account_csv_imports WHERE id='${batch}'`,
      ),
    ).toEqual([
      {
        bytes: csvSource(executions).toString('hex'),
        filename: 'Продажа из начальных лотов.csv',
        state: 'rolled-back',
      },
    ]);
    const versions = await api.versions(account.id, imported[0].tradeId);
    expect(
      versions.items.map((version) => ({ kind: version.kind, version: version.version })),
    ).toEqual([
      { kind: 'void', version: 2 },
      { kind: 'create', version: 1 },
    ]);
  } finally {
    expect(retainedRows(account.id, [], csvTables)).toEqual(prior);
    expect(providerRequests()).toEqual(providers);
    expectAdmissionDelta(admissions, [
      {
        scope: 'csrf-ip',
        subject: await hostSubject(),
        hits: browserCsrfAdmissions() - csrfBefore,
      },
    ]);
    assertQuota();
  }
});

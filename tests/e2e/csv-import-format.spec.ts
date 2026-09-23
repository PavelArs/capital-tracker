import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import {
  browserCsrfAdmissions,
  expectAdmissionDelta,
  hostSubject,
  ledger,
} from './admission-fixtures';
import {
  assertCommitted,
  csvFixture,
  emptySummary,
  expectCsvSummary,
  expectJournalSummary,
  readCsvReceipt,
  retainedState,
} from './csv-import-fixtures';
import { providerRequests, rows, uuid } from './manual-opening-fixtures';
import { fingerprint, test } from './mfa-fixtures';
import { browserPost, trackBrowserRequests } from './usd-trades-fixtures';

const filename = 'Сделки с десятичной запятой.csv';
const source = Buffer.from(
  '\uFEFFinstrument;side;local_time;order;quantity;gross;fee_zero;alternate_fee\r\n' +
    'TOKEN;buy;2025-01-02T03:00:00;0;1,0;100,00;0,00;0\r\n' +
    'TOKEN;buy;2025-01-03T03:00:00;0;1,0;200,00;0,00;0\r\n' +
    'TOKEN;sell;2025-01-04T03:00:00;0;1,5;450,00;0,00;\r\n',
  'utf8',
);

test('CSV-002-A/B / CSV-006-A: real Russian row errors block partial import until explicit decimal-comma, fixed-offset and zero-fee mapping produces exact FIFO', async ({
  page,
}) => {
  const { api, account, instrument } = await csvFixture(page);
  const prior = retainedState();
  const providers = providerRequests();
  const admissions = ledger();
  const csrfBefore = browserCsrfAdmissions();
  const assertQuota = trackBrowserRequests(page, api);
  await page.goto(`/manual-accounts/${account.id}`);
  await expect(page.getByRole('heading', { name: 'Импорт CSV', exact: true })).toBeVisible();
  await page
    .getByLabel('Файл CSV', { exact: true })
    .setInputFiles({ name: filename, mimeType: 'text/csv', buffer: source });
  const upload = await browserPost(page, `/accounts/${account.id}/csv-imports`, () =>
    page.getByRole('button', { name: 'Загрузить CSV', exact: true }).click(),
  );
  expect(upload.status()).toBe(201);
  const identity = await upload.json();
  const batch = uuid(identity.batchId);
  expect(identity.sha256).toBe(createHash('sha256').update(source).digest('hex'));
  expect(identity.byteLength).toBe(source.length);
  await page.getByRole('combobox', { name: 'Разделитель', exact: true }).selectOption(';');
  const inspect = await browserPost(
    page,
    `/accounts/${account.id}/csv-imports/${batch}/inspect`,
    () => page.getByRole('button', { name: 'Просмотреть исходные строки', exact: true }).click(),
  );
  expect(inspect.status()).toBe(200);
  expect(await inspect.json()).toEqual({
    batchId: batch,
    valid: true,
    headers: [
      'instrument',
      'side',
      'local_time',
      'order',
      'quantity',
      'gross',
      'fee_zero',
      'alternate_fee',
    ],
    error: null,
    rows: [
      {
        ordinal: 1,
        startLine: 2,
        cells: ['TOKEN', 'buy', '2025-01-02T03:00:00', '0', '1,0', '100,00', '0,00', '0'],
      },
      {
        ordinal: 2,
        startLine: 3,
        cells: ['TOKEN', 'buy', '2025-01-03T03:00:00', '0', '1,0', '200,00', '0,00', '0'],
      },
      {
        ordinal: 3,
        startLine: 4,
        cells: ['TOKEN', 'sell', '2025-01-04T03:00:00', '0', '1,5', '450,00', '0,00', ''],
      },
    ],
  });
  const mapping = page.getByRole('group', {
    name: 'Сопоставление колонок и значений',
    exact: true,
  });
  const selectedColumns = [
    ['Инструмент', '0'],
    ['Тип сделки', '1'],
    ['Дата сделки', '2'],
    ['Порядок в одну дату', '3'],
    ['Количество', '4'],
    ['Валовая сумма USD', '5'],
    ['Комиссия USD', '7'],
  ];
  for (const [field, index] of selectedColumns)
    await mapping
      .getByRole('combobox', { name: `Колонка: ${field}`, exact: true })
      .selectOption(index);
  const selectInstrument = mapping.getByRole('combobox', {
    name: 'Инструмент для TOKEN',
    exact: true,
  });
  const instrumentOption = selectInstrument.locator(`option[value="${instrument.id}"]`);
  const more = mapping.getByRole('button', {
    name: 'Загрузить ещё инструменты для CSV',
    exact: true,
  });
  for (let loaded = 0; ; loaded++) {
    await expect
      .poll(
        async () =>
          (await instrumentOption.count()) > 0 ||
          ((await more.isVisible()) && (await more.isEnabled())),
      )
      .toBe(true);
    if (await instrumentOption.count()) break;
    expect(loaded, 'Owned instrument discovery remains bounded').toBeLessThan(10);
    const before = await selectInstrument.locator('option').count();
    await more.click();
    await expect
      .poll(
        async () =>
          (await instrumentOption.count()) > 0 ||
          (await selectInstrument.locator('option').count()) > before,
      )
      .toBe(true);
  }
  await selectInstrument.selectOption(instrument.id);
  for (const side of ['buy', 'sell'])
    await mapping
      .getByRole('combobox', { name: `Тип сделки для ${side}`, exact: true })
      .selectOption(side);
  await mapping
    .getByRole('checkbox', { name: 'Валовые суммы и комиссии выражены в USD', exact: true })
    .check();
  await expect(
    mapping.getByRole('combobox', { name: 'Десятичный разделитель', exact: true }),
  ).toHaveValue('.');
  await expect(mapping.getByRole('combobox', { name: 'Формат времени', exact: true })).toHaveValue(
    'offset',
  );
  const unchanged = fingerprint(['auth_sessions', 'auth_request_limits']);
  const previewPath = `/accounts/${account.id}/csv-imports/${batch}/preview`;
  const confirmPath = `/api/accounting/accounts/${account.id}/csv-imports/${batch}/confirm`;
  let confirms = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === confirmPath) confirms++;
  });
  const preview = page.getByRole('region', { name: 'Предпросмотр импорта', exact: true });
  const confirm = page.getByRole('button', { name: 'Подтвердить импорт CSV', exact: true });
  try {
    // Wrong format choices are rejected visibly rather than guessed from these local CSV values.
    const invalid = await browserPost(page, previewPath, () =>
      page.getByRole('button', { name: 'Проверить импорт', exact: true }).click(),
    );
    expect(invalid.status()).toBe(200);
    expect(await invalid.json()).toMatchObject({
      batchId: batch,
      parserVersion: 'usd-csv-v1',
      journalRevision: 0,
      canConfirm: false,
      candidateSummary: null,
      previewHash: null,
      summaryBefore: emptySummary,
      batchErrors: [],
      rows: [1, 2, 3].map((ordinal) => ({ ordinal, startLine: ordinal + 1, execution: null })),
      rowErrors: [1, 2, 3].flatMap((ordinal) => [
        { ordinal, field: 'occurredAt', code: 'invalid-time' },
        { ordinal, field: 'quantity', code: 'invalid-quantity' },
        { ordinal, field: 'grossUsd', code: 'invalid-gross' },
        ...(ordinal === 3 ? [{ ordinal, field: 'feeUsd', code: 'invalid-fee' }] : []),
      ]),
      ignoredColumns: [{ index: 6, header: 'fee_zero' }],
    });
    await expect(preview.getByRole('list', { name: 'Ошибки строк', exact: true })).toContainText(
      'Проверьте дату, календарь и явно выбранное смещение времени.',
    );
    await expect(preview.getByRole('alert')).toContainText(
      'Результат по отдельным допустимым строкам не рассчитывается.',
    );
    await expect(confirm).toBeDisabled();
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(unchanged);

    await mapping
      .getByRole('combobox', { name: 'Десятичный разделитель', exact: true })
      .selectOption(',');
    await mapping
      .getByRole('combobox', { name: 'Формат времени', exact: true })
      .selectOption('fixed-offset');
    await mapping.getByLabel('Фиксированное смещение UTC', { exact: true }).fill('+03:00');
    const normalized = [
      {
        instrumentId: instrument.id,
        side: 'buy',
        occurredAt: '2025-01-02T00:00:00.000Z',
        orderWithinTimestamp: 0,
        quantity: '1',
        grossUsd: '100',
        feeUsd: '0',
      },
      {
        instrumentId: instrument.id,
        side: 'buy',
        occurredAt: '2025-01-03T00:00:00.000Z',
        orderWithinTimestamp: 0,
        quantity: '1',
        grossUsd: '200',
        feeUsd: '0',
      },
      {
        instrumentId: instrument.id,
        side: 'sell',
        occurredAt: '2025-01-04T00:00:00.000Z',
        orderWithinTimestamp: 0,
        quantity: '1.5',
        grossUsd: '450',
        feeUsd: '0',
      },
    ];
    const missingFee = await browserPost(page, previewPath, () =>
      page.getByRole('button', { name: 'Проверить импорт', exact: true }).click(),
    );
    expect(missingFee.status()).toBe(200);
    expect(await missingFee.json()).toMatchObject({
      canConfirm: false,
      candidateSummary: null,
      previewHash: null,
      summaryBefore: emptySummary,
      batchErrors: [],
      rowErrors: [{ ordinal: 3, field: 'feeUsd', code: 'invalid-fee' }],
      rows: normalized.map((execution, index) => ({
        ordinal: index + 1,
        startLine: index + 2,
        execution: index === 2 ? null : execution,
      })),
    });
    await expect(
      preview.getByRole('list', { name: 'Ошибки строк', exact: true }).getByRole('listitem'),
    ).toHaveText(['Запись 3, Комиссия USD: Укажите точную комиссию, включая явный ноль.']);
    await expect(
      preview
        .getByRole('table', { name: 'Сделки перед импортом', exact: true })
        .locator('tbody tr'),
    ).toHaveCount(3);
    await expect(preview.getByRole('region', { name: 'После импорта', exact: true })).toHaveCount(
      0,
    );
    await expect(confirm).toBeDisabled();
    expect(confirms).toBe(0);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(unchanged);

    // Select the actual zero-fee column already present in the immutable original.
    await mapping
      .getByRole('combobox', { name: 'Колонка: Комиссия USD', exact: true })
      .selectOption('6');
    const valid = await browserPost(page, previewPath, () =>
      page.getByRole('button', { name: 'Проверить импорт', exact: true }).click(),
    );
    expect(valid.status()).toBe(200);
    const expected = {
      grossBuysUsd: '300',
      buyFeesUsd: '0',
      grossSalesUsd: '450',
      sellFeesUsd: '0',
      netSalesUsd: '450',
      consumedCostUsd: '200',
      realizedUsd: '250',
      remainingCostUsd: '100',
    };
    expect(await valid.json()).toEqual({
      batchId: batch,
      parserVersion: 'usd-csv-v1',
      journalRevision: 0,
      canConfirm: true,
      rows: normalized.map((execution, index) => ({
        ordinal: index + 1,
        startLine: index + 2,
        execution,
      })),
      ignoredColumns: [{ index: 7, header: 'alternate_fee' }],
      rowErrors: [],
      batchErrors: [],
      summaryBefore: emptySummary,
      candidateSummary: expected,
      previewHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    await expectCsvSummary(page, 'После импорта', expected);
    await expect(preview).toContainText('Неиспользуемые колонки: 8: alternate_fee.');
    await expect(preview.getByRole('list', { name: 'Ошибки строк', exact: true })).toHaveCount(0);
    await expect(confirm).toBeEnabled();
    expect(confirms).toBe(0);
    expect(fingerprint(['auth_sessions', 'auth_request_limits'])).toBe(unchanged);
    const accepted = await browserPost(
      page,
      `/accounts/${account.id}/csv-imports/${batch}/confirm`,
      () => confirm.click(),
    );
    expect(accepted.status()).toBe(201);
    const receipt = readCsvReceipt(await accepted.json());
    expect(receipt).toMatchObject({
      kind: 'confirm',
      rowCount: 3,
      firstJournalRevision: 1,
      lastJournalRevision: 3,
    });
    assertCommitted(receipt);
    expect(confirms).toBe(1);
    await expectJournalSummary(page, expected);
    expect((await api.state(account.id)).journal).toMatchObject({
      journalRevision: 3,
      activeTradeCount: 3,
      versionCount: 3,
      summary: expected,
    });
    expect(
      (await api.lots(account.id)).items.map((row) => [
        row.remainingQuantity,
        row.remainingCostUsd,
      ]),
    ).toEqual([['0.5', '100']]);
    expect(
      rows(`SELECT filename,encode("originalBytes",'hex') AS bytes,"acceptedSettings"->'format' AS format,
      "acceptedSettings"->'mapping'->'columns'->>'feeUsd' AS fee FROM account_csv_imports WHERE id='${batch}'`),
    ).toEqual([
      {
        filename,
        bytes: source.toString('hex'),
        format: {
          delimiter: ';',
          decimalSeparator: ',',
          timestampMode: 'fixed-offset',
          fixedOffset: '+03:00',
        },
        fee: '6',
      },
    ]);
    const provenance = (await api.result(
      'GET',
      `/accounts/${account.id}/csv-imports/${batch}/rows`,
      200,
    )) as { items: { createVersion: Record<string, unknown> }[] };
    expect(provenance.items).toHaveLength(3);
    for (const [index, row] of provenance.items.entries())
      expect(row.createVersion).toMatchObject(normalized[index]);
  } finally {
    expect(retainedState()).toBe(prior);
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

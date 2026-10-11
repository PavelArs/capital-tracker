import { BadRequestException } from '@nestjs/common';
import { parseSettings } from './owner-settings.service';

describe('owner settings input', () => {
  it('takes the main currency alone, as Settings has always sent it', () => {
    expect(parseSettings({ mainCurrency: 'EUR' })).toEqual({ mainCurrency: 'EUR' });
  });

  it('CLS-DUST: takes a dust threshold in USD alone, canonical, or null to turn it off', () => {
    expect(parseSettings({ dustThresholdUsd: '1.50' })).toEqual({ dustThresholdUsd: '1.5' });
    expect(parseSettings({ dustThresholdUsd: '0.00000001' })).toEqual({
      dustThresholdUsd: '0.00000001',
    });
    expect(parseSettings({ dustThresholdUsd: null })).toEqual({ dustThresholdUsd: null });
    expect(parseSettings({ mainCurrency: 'RUB', dustThresholdUsd: '1000000' })).toEqual({
      mainCurrency: 'RUB',
      dustThresholdUsd: '1000000',
    });
  });

  it.each([
    [{}],
    [null],
    [[]],
    [{ mainCurrency: 'GBP' }],
    [{ dustThresholdUsd: '0' }],
    [{ dustThresholdUsd: '-1' }],
    [{ dustThresholdUsd: 1 }],
    [{ dustThresholdUsd: '1000000.01' }],
    [{ dustThresholdUsd: '0.000000001' }],
    [{ dustThresholdUsd: '1e3' }],
    [{ mainCurrency: 'USD', extra: true }],
  ])('refuses %j', (input) => {
    expect(() => parseSettings(input)).toThrow(BadRequestException);
  });
});

describe('owner settings insight rules', () => {
  const first = '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f6a7';
  const second = '4a2b3c5d-6e7f-4081-9ba2-c3d4e5f6a7b8';
  const rules = {
    targets: [
      { instrumentId: first, percent: '50' },
      { instrumentId: second, percent: '25.5' },
    ],
    driftPoints: '5',
    gainReviewPercent: '100',
    lossReviewPercent: '40',
  };

  it('INS-RULES: takes rules alone, canonical, or null to clear them', () => {
    expect(parseSettings({ insightRules: rules })).toEqual({ insightRules: rules });
    expect(
      parseSettings({
        insightRules: {
          ...rules,
          driftPoints: '5.0',
          gainReviewPercent: null,
          lossReviewPercent: null,
        },
      }),
    ).toEqual({
      insightRules: {
        ...rules,
        driftPoints: '5',
        gainReviewPercent: null,
        lossReviewPercent: null,
      },
    });
    expect(parseSettings({ insightRules: { ...rules, targets: [] } })).toEqual({
      insightRules: { ...rules, targets: [] },
    });
    expect(parseSettings({ insightRules: null })).toEqual({ insightRules: null });
  });

  it.each([
    ['a repeated asset', { targets: [rules.targets[0], rules.targets[0]] }],
    [
      'targets above 100 together',
      {
        targets: [
          { instrumentId: first, percent: '60' },
          { instrumentId: second, percent: '41' },
        ],
      },
    ],
    ['a zero target', { targets: [{ instrumentId: first, percent: '0' }] }],
    ['a target above 100', { targets: [{ instrumentId: first, percent: '100.01' }] }],
    ['a number instead of text', { targets: [{ instrumentId: first, percent: 50 }] }],
    ['a malformed asset id', { targets: [{ instrumentId: 'btc', percent: '50' }] }],
    ['an unknown target field', { targets: [{ instrumentId: first, percent: '50', note: 'x' }] }],
    [
      'more than 50 targets',
      {
        targets: Array.from({ length: 51 }, (_, i) => ({
          instrumentId: `3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5${String(i).padStart(4, '0')}`,
          percent: '1',
        })),
      },
    ],
    ['a zero drift', { driftPoints: '0' }],
    ['a drift above 50', { driftPoints: '50.01' }],
    ['a loss level of 100', { lossReviewPercent: '100' }],
    ['a gain level above 10000', { gainReviewPercent: '10001' }],
    ['an unknown rule field', { extra: true }],
  ])('INS-RULES: refuses %s', (_name, change) => {
    expect(() => parseSettings({ insightRules: { ...rules, ...change } })).toThrow(
      BadRequestException,
    );
  });

  it('INS-RULES: refuses rules that are not an object', () => {
    for (const bad of ['x', 1, [], { driftPoints: '5' }])
      expect(() => parseSettings({ insightRules: bad })).toThrow(BadRequestException);
  });
});

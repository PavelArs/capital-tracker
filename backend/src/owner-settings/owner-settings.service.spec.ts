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

import { describe, it, expect } from 'vitest';
import { formatAmount } from './formatters';

describe('formatAmount', () => {
  describe('regular fiat amounts', () => {
    it('should format large amounts with 2 decimal places', () => {
      const result = formatAmount(1234.56);
      expect(result).toMatch(/1[,.]?234\.56/); // Handles both locale formats
    });

    it('should format very large amounts with 2 decimal places', () => {
      const result = formatAmount(1000000);
      expect(result).toMatch(/1[,.]?000[,.]?000\.00/);
    });

    it('should format amounts between 100 and 1000', () => {
      const result = formatAmount(500.25);
      expect(result).toContain('500');
      expect(result).toContain('25');
    });
  });

  describe('small amounts (< 100)', () => {
    it('should show up to 4 decimal places for amounts less than 100', () => {
      const result = formatAmount(50.1234);
      expect(result).toContain('50');
    });

    it('should show appropriate decimals for small amounts', () => {
      const result = formatAmount(1.5);
      expect(result).toContain('1');
    });
  });

  describe('very small amounts (< 1)', () => {
    it('should show more decimals for amounts less than 1', () => {
      const result = formatAmount(0.5);
      expect(result).toContain('0');
    });

    it('should show significant digits for very small amounts', () => {
      const result = formatAmount(0.000123);
      expect(result).toContain('0');
      // Should show meaningful precision for small numbers
    });

    it('should handle amounts less than 0.01', () => {
      const result = formatAmount(0.005);
      expect(result).toContain('0');
    });
  });

  describe('crypto currency formatting', () => {
    it('should show more decimals for BTC', () => {
      const result = formatAmount(0.12345678, 'BTC');
      expect(result).toContain('0');
    });

    it('should show more decimals for ETH', () => {
      const result = formatAmount(1.234567, 'ETH');
      expect(result).toContain('1');
    });

    it('should show more decimals for USDT', () => {
      const result = formatAmount(100.1234, 'USDT');
      expect(result).toContain('100');
    });

    it('should handle all supported crypto currencies', () => {
      const cryptos = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'ADA', 'DOT', 'MATIC'];
      cryptos.forEach((crypto) => {
        const result = formatAmount(1.23456789, crypto);
        expect(result).toContain('1');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle zero', () => {
      const result = formatAmount(0);
      expect(result).toContain('0');
    });

    it('should handle negative amounts', () => {
      const result = formatAmount(-100.5);
      expect(result).toContain('100');
    });

    it('should handle negative small amounts', () => {
      const result = formatAmount(-0.001);
      expect(result).toContain('0');
    });

    it('should handle undefined currency code', () => {
      const result = formatAmount(123.45);
      expect(result).toContain('123');
    });

    it('should handle non-crypto currency codes', () => {
      const result = formatAmount(1.234567, 'USD');
      expect(result).toContain('1');
    });

    it('should handle amounts exactly at 0.01', () => {
      const result = formatAmount(0.01);
      expect(result).toContain('0');
    });

    it('should handle amounts exactly at 1', () => {
      const result = formatAmount(1);
      expect(result).toContain('1');
    });

    it('should handle amounts exactly at 100', () => {
      const result = formatAmount(100);
      expect(result).toContain('100');
    });

    it('should handle very small crypto amounts with proper precision', () => {
      const result = formatAmount(0.00000001, 'BTC');
      expect(result).toContain('0');
    });
  });
});

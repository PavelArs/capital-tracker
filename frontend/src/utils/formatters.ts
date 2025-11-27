/**
 * Smart number formatting based on value and currency type
 * Automatically adjusts decimal places to show meaningful precision
 *
 * @param amount - The numeric amount to format
 * @param currencyCode - Optional currency code (e.g., 'BTC', 'USD', 'EUR')
 * @returns Formatted string with appropriate decimal places
 *
 * @example
 * formatAmount(0.000123, 'BTC') // '0.000123'
 * formatAmount(123.45, 'USD') // '123.45'
 * formatAmount(0.1, 'BTC') // '0.10'
 */
export const formatAmount = (amount: number, currencyCode?: string): string => {
  const absAmount = Math.abs(amount);

  // For crypto currencies or very small amounts, show more decimal places
  const isCrypto =
    currencyCode &&
    ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'ADA', 'DOT', 'MATIC'].includes(currencyCode);

  if (isCrypto || absAmount < 1) {
    // For very small amounts or crypto, use dynamic minimum decimals to avoid showing 0.00
    // Find the position of the first significant digit after decimal point
    let minDecimals = 2;
    if (absAmount > 0 && absAmount < 0.01) {
      // For very small numbers, find first non-zero digit
      const str = absAmount.toString();
      const decimalPart = str.split('.')[1] || '';
      const firstNonZero = decimalPart.search(/[1-9]/);
      if (firstNonZero >= 0) {
        minDecimals = Math.min(firstNonZero + 2, 8); // Show at least 2 digits after first significant digit
      }
    }

    return amount.toLocaleString(undefined, {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: 8,
    });
  } else if (absAmount < 100) {
    // For small amounts, show up to 4 decimal places
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  } else {
    // For regular amounts, show 2 decimal places
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
};

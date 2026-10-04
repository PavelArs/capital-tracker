import { BadRequestException } from '@nestjs/common';
import { normalizeBitcoinAddress } from './bitcoin-address';

describe('ADDR-ADD: Bitcoin mainnet address validation', () => {
  it.each([
    ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
    // 32-byte v0 program; checksum computed with the BIP-173 algorithm verified above.
    [
      'bc1qrp33g2q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q6vkm53',
      'bc1qrp33g2q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q6vkm53',
    ],
    [
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
    ],
    ['BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
  ])('accepts %s as %s', (input, normalized) => {
    expect(normalizeBitcoinAddress(input)).toBe(normalized);
  });

  it.each([
    ['mixed-case bech32', 'bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['bech32 checksum typo', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdp'],
    ['base58 checksum typo', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3'],
    ['testnet bech32', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
    ['testnet base58', 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'],
    [
      'taproot with bech32 instead of bech32m checksum',
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd',
    ],
    ['truncated v0 program', 'bc1qrp33g2q5c5txsp9arysrx4k6zdkfs4nce4xj0g6vkm53'],
    ['surrounding whitespace', ' 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
    ['free text', 'not-an-address'],
    ['empty', ''],
  ])('rejects %s', (_case, input) => {
    expect(() => normalizeBitcoinAddress(input)).toThrow(BadRequestException);
  });

  it.each([undefined, null, 42, ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'], { address: 'x' }])(
    'rejects non-string %p',
    (input) => {
      expect(() => normalizeBitcoinAddress(input)).toThrow(BadRequestException);
    },
  );
});

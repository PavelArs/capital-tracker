import { BadRequestException } from '@nestjs/common';
import { normalizeEthereumAddress } from './ethereum-address';

// EIP-55's own test vectors; no owner address appears here.
const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

describe('WAL-INVALID: Ethereum address input', () => {
  it.each([
    ['a checksummed address', checksummed],
    ['an all lower-case address', checksummed.toLowerCase()],
    ['an all upper-case address', `0x${checksummed.slice(2).toUpperCase()}`],
    ['an upper-case prefix', `0X${checksummed.slice(2)}`],
  ])('stores %s in lower case', (_case, value) => {
    expect(normalizeEthereumAddress(value)).toBe('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
  });

  it('accepts the other EIP-55 vectors', () => {
    for (const value of [
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ])
      expect(normalizeEthereumAddress(value)).toBe(value.toLowerCase());
  });

  it.each([
    ['a mixed-case address with a wrong checksum', checksummed.replace('aAeb', 'AAeb')],
    ['a Bitcoin address', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['an address without 0x', checksummed.slice(2)],
    ['a short address', checksummed.slice(0, 41)],
    ['a private key', `0x${'4c'.repeat(32)}`],
    ['outer spaces', ` ${checksummed}`],
    ['a number', 7],
  ])('refuses %s', (_case, value) => {
    expect(() => normalizeEthereumAddress(value)).toThrow(BadRequestException);
  });
});

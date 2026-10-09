import { BadRequestException } from '@nestjs/common';
import { normalizeBitcoinAddress } from './bitcoin-address';
import {
  AccountKey,
  deriveChildKey,
  encodeExtendedKey,
  isExtendedKey,
  normalizeExtendedKey,
  parseExtendedKey,
} from './bitcoin-xpub';

// Public test vectors only: BIP-32 test vector 1 and the accounts of the BIP-39 test mnemonic
// "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
// published with BIP-84 (zpub) and the reference wallets for BIP-44 (xpub) and BIP-49 (ypub).
const bip44 =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const bip49 =
  'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
const bip84 =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

describe('XPUB-KEY: Bitcoin account public keys', () => {
  it.each([
    [bip44, 'xpub', 'legacy'],
    [bip49, 'ypub', 'nested-segwit'],
    [bip84, 'zpub', 'native-segwit'],
  ])('reads %s as a %s key with %s addresses', (text, prefix, script) => {
    expect(isExtendedKey(text)).toBe(true);
    const key = parseExtendedKey(text);
    expect(key.prefix).toBe(prefix);
    expect(key.script).toBe(script);
    expect(normalizeExtendedKey(text)).toBe(text);
  });

  it.each([
    ['a single address', '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA'],
    ['a checksum typo', `${bip84.slice(0, -1)}t`],
    ['a truncated key', bip84.slice(0, -4)],
    // The private counterpart of a key is never accepted, even to be dropped.
    [
      'an extended private key',
      'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
    ],
    // Testnet keys (tpub, vpub) are not mainnet wallets.
    [
      'a testnet key',
      'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp',
    ],
    ['not text', 42],
  ])('refuses %s', (_case, text) => {
    expect(() => normalizeExtendedKey(text)).toThrow(BadRequestException);
  });

  it.each([
    ['an x coordinate beyond the field', (key: Buffer) => key.fill(0xff, 46)],
    ['an uncompressed key prefix', (key: Buffer) => key.fill(0x04, 45, 46)],
  ])('refuses a key with %s, its checksum recomputed', (_case, change) => {
    const broken = Buffer.from(parseExtendedKey(bip44).serialized);
    change(broken);
    expect(() => parseExtendedKey(encodeExtendedKey(broken))).toThrow(BadRequestException);
  });

  it('encodes a parsed key back to the same text', () => {
    expect(encodeExtendedKey(parseExtendedKey(bip84).serialized)).toBe(bip84);
  });
});

describe('XPUB-DERIVE: public child keys (BIP-32)', () => {
  it('derives test vector 1 m/0H/1 from m/0H', () => {
    const parent = parseExtendedKey(
      'xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw',
    );
    const expected = parseExtendedKey(
      'xpub6ASuArnXKPbfEwhqN6e3mwBcDTgzisQN1wXN9BJcM47sSikHjJf3UFHKkNAWbWMiGj7Wf5uMash7SyYq527Hqck2AxYysAA7xmALppuCkwQ',
    );
    const child = deriveChildKey(parent, 1);
    expect(child.publicKey.toString('hex')).toBe(expected.publicKey.toString('hex'));
    expect(child.chainCode.toString('hex')).toBe(expected.chainCode.toString('hex'));
  });

  it('derives test vector 1 m/0H/1/2H/2/1000000000 from m/0H/1/2H/2', () => {
    const parent = parseExtendedKey(
      'xpub6FHa3pjLCk84BayeJxFW2SP4XRrFd1JYnxeLeU8EqN3vDfZmbqBqaGJAyiLjTAwm6ZLRQUMv1ZACTj37sR62cfN7fe5JnJ7dh8zL4fiyLHV',
    );
    const expected = parseExtendedKey(
      'xpub6H1LXWLaKsWFhvm6RVpEL9P4KfRZSW7abD2ttkWP3SSQvnyA8FSVqNTEcYFgJS2UaFcxupHiYkro49S8yGasTvXEYBVPamhGW6cFJodrTHy',
    );
    const child = deriveChildKey(parent, 1_000_000_000);
    expect(child.publicKey.toString('hex')).toBe(expected.publicKey.toString('hex'));
    expect(child.chainCode.toString('hex')).toBe(expected.chainCode.toString('hex'));
  });

  it('refuses a hardened index, which needs the private key', () => {
    expect(() => deriveChildKey(parseExtendedKey(bip44), 0x80000000)).toThrow();
  });
});

describe('XPUB-ADDRESS: receiving and change addresses of an account key', () => {
  it.each([
    [bip44, 0, 0, '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA'],
    [bip44, 0, 1, '1Ak8PffB2meyfYnbXZR9EGfLfFZVpzJvQP'],
    [bip49, 0, 0, '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf'],
    [bip84, 0, 0, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'],
    [bip84, 0, 1, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'],
    [bip84, 1, 0, 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el'],
  ])('%s chain %i index %i is %s', (text, chain, index, address) => {
    const account = new AccountKey(text);
    expect(account.address(chain as 0 | 1, index)).toBe(address);
    // Every derived address is one the app already accepts as a Bitcoin address.
    expect(normalizeBitcoinAddress(address)).toBe(address);
  });

  it('derives the same address however often it is asked', () => {
    const account = new AccountKey(bip84);
    const first = account.address(1, 7);
    expect(account.address(1, 7)).toBe(first);
    expect(new AccountKey(bip84).address(1, 7)).toBe(first);
  });
});

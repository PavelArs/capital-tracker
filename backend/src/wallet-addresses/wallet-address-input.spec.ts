import { BadRequestException } from '@nestjs/common';
import { parseRegistration, parseUpdate } from './wallet-address-input';

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const accountId = '00000000-0000-4000-8000-000000000001';
// An EIP-55 test vector, not an owner's address.
const ethereum = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
// The System Program's id: a well-known public key, never an owner's wallet.
const solana = '11111111111111111111111111111111';
// Synthetic BIP-39 words in the order of the standard test vector, never a real wallet.
const seedPhrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('WAL-ADD: wallet registration input', () => {
  it('keeps the legacy address-only body as a Bitcoin address', () => {
    expect(parseRegistration({ address })).toEqual({
      network: 'bitcoin',
      address,
      accountId: null,
      label: null,
    });
  });

  it('takes an Ethereum address in lower case (M14)', () => {
    expect(parseRegistration({ network: 'ethereum', address: ethereum, accountId })).toEqual({
      network: 'ethereum',
      address: ethereum.toLowerCase(),
      accountId,
      label: null,
    });
  });

  it('takes a Solana address exactly as given (M15)', () => {
    expect(parseRegistration({ network: 'solana', address: solana })).toEqual({
      network: 'solana',
      address: solana,
      accountId: null,
      label: null,
    });
  });

  it('takes a Bitcoin account public key exactly as given (M21)', () => {
    // The BIP-84 test vector's account key, never an owner's wallet.
    const zpub =
      'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    expect(parseRegistration({ network: 'bitcoin', address: zpub, accountId })).toEqual({
      network: 'bitcoin',
      address: zpub,
      accountId,
      label: null,
    });
    // The key is a Bitcoin one only.
    expect(() => parseRegistration({ network: 'solana', address: zpub })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseRegistration({ network: 'bitcoin', address: `${zpub.slice(0, -1)}t` }),
    ).toThrow(BadRequestException);
  });

  it('binds the address to an account with a trimmed label', () => {
    expect(
      parseRegistration({
        network: 'bitcoin',
        address,
        accountId: accountId.toUpperCase(),
        label: '  Trust Wallet BTC ',
      }),
    ).toEqual({ network: 'bitcoin', address, accountId, label: 'Trust Wallet BTC' });
  });

  it('treats a blank label as none', () => {
    expect(parseRegistration({ address, label: '   ' })).toEqual({
      network: 'bitcoin',
      address,
      accountId: null,
      label: null,
    });
  });

  it.each([
    ['WAL-INVALID: a Bitcoin address as Ethereum', { network: 'ethereum', address }],
    ['an Ethereum address as Bitcoin', { network: 'bitcoin', address: ethereum }],
    ['a Bitcoin address as Solana', { network: 'solana', address }],
    ['an Ethereum address as Solana', { network: 'solana', address: ethereum }],
    ['a Solana address as Ethereum', { network: 'ethereum', address: solana }],
    ['a network not tracked', { network: 'tron', address }],
    ['a label over 40 characters', { address, label: 'x'.repeat(41) }],
    ['a label with a control character', { address, label: 'Cold\nwallet' }],
    ['a label that is not text', { address, label: 7 }],
    ['an account that is not a uuid', { address, accountId: 'trust' }],
    ['an unknown field', { address, privateKey: 'x' }],
    ['a seed phrase field', { address, seed: seedPhrase }],
  ])('refuses %s', (_case, input) => {
    expect(() => parseRegistration(input)).toThrow(BadRequestException);
  });
});

describe('WAL-NO-SECRETS: a seed phrase is never accepted as an address', () => {
  it.each([
    ['12 words', seedPhrase],
    ['24 words', `${seedPhrase} ${seedPhrase}`],
  ])('refuses %s without echoing them', (_case, phrase) => {
    let error: unknown;
    try {
      parseRegistration({ address: phrase });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain('abandon');
  });
});

describe('WAL-ACCOUNT: changing a wallet address', () => {
  it('moves the address to an account and names it', () => {
    expect(parseUpdate({ accountId, label: 'Cold BTC' })).toEqual({ accountId, label: 'Cold BTC' });
  });

  it('clears the name and the account with null', () => {
    expect(parseUpdate({ accountId: null, label: null })).toEqual({
      accountId: null,
      label: null,
    });
    expect(parseUpdate({ label: '' })).toEqual({ label: null });
  });

  it('changes only what is sent', () => {
    expect(parseUpdate({ label: 'Savings' })).toEqual({ label: 'Savings' });
    expect(parseUpdate({ accountId })).toEqual({ accountId });
  });

  it.each([
    ['an empty body', {}],
    ['the address itself', { address }],
    ['a bad account', { accountId: 'x' }],
    ['a long label', { label: 'x'.repeat(41) }],
    ['no object', null],
  ])('refuses %s', (_case, input) => {
    expect(() => parseUpdate(input)).toThrow(BadRequestException);
  });
});

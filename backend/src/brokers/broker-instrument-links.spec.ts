import { instrumentFacts, resolveLinks, type SavedLink } from './broker-instrument-links';
import type { TBankOperation } from './tbank-client';

const exchange = '00000000-0000-4000-8000-0000000000e1';
const venue = '00000000-0000-4000-8000-0000000000e2';
const asset = '00000000-0000-4000-8000-0000000000a1';
const otherAsset = '00000000-0000-4000-8000-0000000000a2';
const buy: TBankOperation = {
  id: '100000001',
  parentId: '',
  state: 'executed',
  type: 'OPERATION_TYPE_BUY',
  occurredAt: '2024-03-01T12:00:00Z',
  instrumentUid: venue,
  assetUid: asset,
  instrumentType: 'etf',
  ticker: 'SYNTH@',
  quantity: '2',
  payment: '-100',
  paymentCurrency: 'rub',
  price: '50',
  priceCurrency: 'rub',
  commission: '',
  commissionCurrency: '',
  fills: [],
};
const link = (over: Partial<SavedLink> = {}): SavedLink => ({
  uid: exchange,
  assetUid: asset,
  instrumentType: 'etf',
  id: 'instrument-1',
  name: 'SYNTH',
  symbol: 'SYNTH',
  ...over,
});
const facts = (rows: TBankOperation[] = [buy], wanted = [venue]) => {
  const value = instrumentFacts(wanted, rows);
  if (!value) throw new Error('facts refused');
  return value;
};

describe('BROKER-ASSET-ID: instrument links across accounts', () => {
  it('BROKER-ASSET-ID names the asset, type and original UIDs of each wanted instrument', () => {
    const value = facts([{ ...buy, providerInstrumentUid: exchange }]);
    expect(value.get(venue)).toEqual({
      uids: new Set([venue, exchange]),
      assetUid: asset,
      instrumentType: 'etf',
    });
  });

  it('BROKER-ASSET-ID refuses one instrument that T-Bank names with two assets', () => {
    const rows = [buy, { ...buy, id: '100000002', assetUid: otherAsset }];
    expect(instrumentFacts([venue], rows)).toBe(undefined);
  });

  it('BROKER-ASSET-ID resolves a venue UID to the instrument another account linked by asset', () => {
    expect(resolveLinks(facts(), [link()])?.get(venue)?.id).toBe('instrument-1');
  });

  it('BROKER-ASSET-ID still resolves a link saved before asset UIDs by its instrument UID', () => {
    const legacy = link({ uid: venue, assetUid: null, instrumentType: null });
    expect(resolveLinks(facts(), [legacy])?.get(venue)).toBe(legacy);
  });

  it('BROKER-ASSET-ID leaves an asset nothing links to a new instrument', () => {
    expect(resolveLinks(facts(), [link({ assetUid: otherAsset })])?.has(venue)).toBe(false);
  });

  it('BROKER-ASSET-ID refuses an asset already bound to another security type', () => {
    expect(resolveLinks(facts(), [link({ instrumentType: 'share' })])).toBe(undefined);
  });

  it('BROKER-ASSET-ID refuses a linked instrument UID that now names another asset', () => {
    expect(resolveLinks(facts(), [link({ uid: venue, assetUid: otherAsset })])).toBe(undefined);
  });

  it('BROKER-ASSET-ID refuses a UID link and an asset link to two instruments', () => {
    const saved = [link(), link({ uid: venue, assetUid: null, id: 'instrument-2' })];
    expect(resolveLinks(facts(), saved)).toBe(undefined);
  });

  it('BROKER-ASSET-ID refuses two holdings of one import on one instrument', () => {
    // The venue UID reaches the link by asset, the unnamed exchange UID by its own UID.
    const exchangeBuy = { ...buy, id: '100000002', instrumentUid: exchange, assetUid: undefined };
    expect(resolveLinks(facts([buy, exchangeBuy], [venue, exchange]), [link()])).toBe(undefined);
  });
});

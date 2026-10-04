import { BadRequestException } from '@nestjs/common';
import { parseCompletion, parseTxid } from './wallet-address-input';

describe('ADDRT-INVALID: completion input', () => {
  it('accepts a lowercase 64-hex txid only', () => {
    const txid = 'ab'.repeat(32);
    expect(parseTxid(txid)).toBe(txid);
    for (const value of [txid.toUpperCase(), txid.slice(1), `${txid}0`, '', undefined, 42]) {
      expect(() => parseTxid(value)).toThrow(BadRequestException);
    }
  });

  it('passes the account and the opaque trade body through and rejects any other key', () => {
    const trade = { side: 'buy' };
    expect(parseCompletion({ accountId: 'a', trade })).toEqual({ accountId: 'a', trade });
    for (const value of [null, [], 'x', { accountId: 'a', trade, extra: true }]) {
      expect(() => parseCompletion(value)).toThrow(BadRequestException);
    }
  });
});

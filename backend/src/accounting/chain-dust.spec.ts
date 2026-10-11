import { isDust } from './chain-dust';

// CLS-DUST: synthetic amounts only.
describe('chain dust threshold', () => {
  it('an incoming transaction worth less than the threshold is dust', () => {
    expect(isDust('in', '0.000012', '1')).toBe(true);
    expect(
      isDust('in', '0.999999999999999999999999999999999999999999999999999999999999', '1'),
    ).toBe(true);
  });

  it('a transaction worth the threshold or more is not dust', () => {
    expect(isDust('in', '1', '1')).toBe(false);
    expect(isDust('in', '1.0000000001', '1')).toBe(false);
    expect(isDust('in', '25.5', '0.5')).toBe(false);
  });

  it('nothing is dust without a threshold', () => {
    expect(isDust('in', '0', null)).toBe(false);
  });

  it('a transaction without a price is not dust', () => {
    expect(isDust('in', null, '1')).toBe(false);
    expect(isDust('in', null, null)).toBe(false);
  });

  it('TOKEN-HIDE a leg of a token the address leaves out is dust whichever way it went', () => {
    expect(isDust('out', '40', null, true)).toBe(true);
    expect(isDust('in', '40', '1', true)).toBe(true);
    expect(isDust('self', null, null, true)).toBe(true);
    expect(isDust('out', '40', null, false)).toBe(false);
    expect(isDust('in', null, null, false)).toBe(false);
  });

  it('only incoming transactions can be dust: what the owner sent always asks', () => {
    expect(isDust('out', '0.01', '1')).toBe(false);
    expect(isDust('self', '0.01', '1')).toBe(false);
  });
});

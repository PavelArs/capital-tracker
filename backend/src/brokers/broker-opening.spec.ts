import { openingPositions, openingQuantities, parseBrokerOpening } from './broker-opening';

const asset = '00000000-0000-4000-8000-000000000001';
const lot = {
  asset,
  acquiredAt: '2024-02-01T00:00:00Z',
  quantity: '0.12345678901234567890123456789',
  costUsd: '10.000000000000000000000000000001',
};
const opening = { asOf: '2024-02-25T00:00:00Z', lots: [lot] };
describe('BROKER-OPENING', () => {
  it('preserves exact declared quantities and costs and reconciles multiple lots', () => {
    const parsed = parseBrokerOpening({ ...opening, lots: [lot, lot] })!;
    expect(openingQuantities(parsed).get(asset)).toBe(246913578024691357802469135780n);
    expect(
      openingPositions(parsed.lots.map((value) => ({ ...value, instrumentId: value.asset }))),
    ).toEqual([
      {
        instrumentId: asset,
        quantity: '0.24691357802469135780246913578',
        costStatus: 'known',
        totalCostUsd: '20.000000000000000000000000000002',
      },
    ]);
  });
  it.each([null, '', undefined, '-1'])(
    'never invents a cost when the owner supplies %s',
    (costUsd) => {
      expect(() => parseBrokerOpening({ ...opening, lots: [{ ...lot, costUsd }] })).toThrow();
    },
  );
  it('rejects acquisitions after the opening and unknown properties', () => {
    expect(() =>
      parseBrokerOpening({ ...opening, lots: [{ ...lot, acquiredAt: '2024-03-01T00:00:00Z' }] }),
    ).toThrow();
    expect(() => parseBrokerOpening({ ...opening, guessedBalance: '1' })).toThrow();
    expect(() => parseBrokerOpening({ ...opening, lots: [{ ...lot, quantity: '0' }] })).toThrow();
  });
});

import type { TBankOperation, TBankPosition, TBankResult } from './tbank-client';

/** A position is one security on one exchange; its trading modes have different instrument UIDs.
 * One asset traded on two venues (a fund bought on the exchange and sold on T-Bank's own venue)
 * is two positions of the same asset, so the same asset UID joins them too.
 * https://github.com/RussianInvestments/investAPI/blob/main/src/docs/faq_identification.md */
export function positionIdentities(
  operations: readonly TBankOperation[],
  positions: readonly TBankPosition[],
): TBankResult<{ operations: TBankOperation[]; positions: TBankPosition[] }> {
  const security = (row: TBankOperation | TBankPosition) =>
    ['share', 'bond', 'etf'].includes(row.instrumentType);
  const rows = [...operations, ...positions.filter((row) => !row.virtual)];
  // Each instrument names at most one position and one asset; instruments that share either
  // are one holding.
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;
    return up === id ? id : root(up);
  };
  const join = (a: string, b: string) => {
    const [x, y] = [root(a), root(b)].sort();
    if (x !== y) parent.set(y, x);
  };
  const named = { positionUid: new Map<string, string>(), assetUid: new Map<string, string>() };
  for (const row of rows) {
    if (!security(row) || !row.instrumentUid) continue;
    for (const key of ['positionUid', 'assetUid'] as const) {
      const value = (row as { positionUid?: string; assetUid?: string })[key];
      if (!value) continue;
      const previous = named[key].get(row.instrumentUid);
      if (previous && previous !== value) return { ok: false, reason: 'invalid_response' };
      named[key].set(row.instrumentUid, value);
      join(`${key}:${value}`, `instrument:${row.instrumentUid}`);
    }
  }
  const groups = new Map<string, { type: string; ids: Set<string>; held: Set<string> }>();
  const groupOf = (instrumentUid: string) =>
    named.positionUid.has(instrumentUid) || named.assetUid.has(instrumentUid)
      ? root(`instrument:${instrumentUid}`)
      : undefined;
  for (const row of rows) {
    if (!security(row)) continue;
    const id = groupOf(row.instrumentUid);
    if (!id) continue;
    const group = groups.get(id) ?? { type: row.instrumentType, ids: new Set(), held: new Set() };
    if (group.type !== row.instrumentType) return { ok: false, reason: 'invalid_response' };
    group.ids.add(row.instrumentUid);
    groups.set(id, group);
  }
  for (const row of positions) {
    if (row.virtual || !security(row)) continue;
    const id = groupOf(row.instrumentUid);
    if (id) groups.get(id)!.held.add(row.instrumentUid);
  }
  for (const row of rows) {
    const id = groupOf(row.instrumentUid);
    if (id && row.instrumentType && row.instrumentType !== groups.get(id)?.type)
      return { ok: false, reason: 'invalid_response' };
  }
  const canonical = new Map<string, string>();
  for (const [id, group] of groups) {
    // Two current rows of one position might be duplicated holdings; never sum them on an
    // identity guess. Rows of different positions (one asset on two venues) are both held.
    const heldPositions = new Set([...group.held].map((uid) => named.positionUid.get(uid)));
    if (heldPositions.size < group.held.size) return { ok: false, reason: 'invalid_response' };
    canonical.set(id, [...group.held].sort()[0] ?? [...group.ids].sort()[0]);
  }
  const identify = <T extends TBankOperation | TBankPosition>(row: T): T => {
    const id = groupOf(row.instrumentUid);
    const uid = id && security(row) ? canonical.get(id) : undefined;
    return uid && uid !== row.instrumentUid
      ? { ...row, instrumentUid: uid, providerInstrumentUid: row.instrumentUid }
      : row;
  };
  return {
    ok: true,
    value: {
      operations: operations.map(identify),
      positions: positions.map((row) => (row.virtual ? row : identify(row))),
    },
  };
}

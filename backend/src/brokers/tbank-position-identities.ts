import type { TBankOperation, TBankPosition, TBankResult } from './tbank-client';

/** A position is one security on one exchange; its trading modes have different instrument UIDs.
 * https://github.com/RussianInvestments/investAPI/blob/main/src/docs/faq_identification.md */
export function positionIdentities(
  operations: readonly TBankOperation[],
  positions: readonly TBankPosition[],
): TBankResult<{ operations: TBankOperation[]; positions: TBankPosition[] }> {
  const groups = new Map<string, { type: string; ids: Set<string>; held: Set<string> }>();
  const instruments = new Map<string, string>();
  const security = (row: TBankOperation | TBankPosition) =>
    ['share', 'bond', 'etf'].includes(row.instrumentType);
  for (const row of [...operations, ...positions.filter((row) => !row.virtual)]) {
    if (!security(row) || !row.positionUid || !row.instrumentUid) continue;
    const previous = instruments.get(row.instrumentUid);
    if (previous && previous !== row.positionUid) return { ok: false, reason: 'invalid_response' };
    instruments.set(row.instrumentUid, row.positionUid);
    const group = groups.get(row.positionUid) ?? {
      type: row.instrumentType,
      ids: new Set<string>(),
      held: new Set<string>(),
    };
    if (group.type !== row.instrumentType) return { ok: false, reason: 'invalid_response' };
    group.ids.add(row.instrumentUid);
    groups.set(row.positionUid, group);
  }
  for (const row of positions) {
    if (row.virtual || !security(row)) continue;
    const id = instruments.get(row.instrumentUid);
    if (id) groups.get(id)!.held.add(row.instrumentUid);
  }
  for (const row of [...operations, ...positions.filter((row) => !row.virtual)]) {
    const position = instruments.get(row.instrumentUid);
    if (position && row.instrumentType && row.instrumentType !== groups.get(position)!.type)
      return { ok: false, reason: 'invalid_response' };
  }
  const canonical = new Map<string, string>();
  for (const [position, group] of groups) {
    // Multiple current rows might be duplicated holdings; never sum them on an identity guess.
    if (group.held.size > 1) return { ok: false, reason: 'invalid_response' };
    canonical.set(position, [...group.held][0] ?? [...group.ids].sort()[0]);
  }
  const identify = <T extends TBankOperation | TBankPosition>(row: T): T => {
    const position = instruments.get(row.instrumentUid);
    const uid = position && security(row) ? canonical.get(position) : undefined;
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

import type { TBankOperation, TBankPosition, TBankResult } from './tbank-client';

type Row = TBankOperation | TBankPosition;
/** The position and the asset each security instrument names, by its instrument UID. */
interface Named {
  positionUid: Map<string, string>;
  assetUid: Map<string, string>;
}
interface Group {
  type: string;
  ids: Set<string>;
  held: Set<string>;
}

const security = (row: Row) => ['share', 'bond', 'etf'].includes(row.instrumentType);

const rootOf = (parent: ReadonlyMap<string, string>, id: string): string => {
  const up = parent.get(id) ?? id;
  return up === id ? id : rootOf(parent, up);
};

/** A position is one security on one exchange; its trading modes have different instrument UIDs.
 * One asset traded on two venues (a fund bought on the exchange and sold on T-Bank's own venue)
 * is two positions of the same asset, so the same asset UID joins them too.
 * https://github.com/RussianInvestments/investAPI/blob/main/src/docs/faq_identification.md */
export function positionIdentities(
  operations: readonly TBankOperation[],
  positions: readonly TBankPosition[],
): TBankResult<{ operations: TBankOperation[]; positions: TBankPosition[] }> {
  const rows = [...operations, ...positions.filter((row) => !row.virtual)];
  // Each instrument names at most one position and one asset; instruments that share either
  // are one holding.
  const parent = new Map<string, string>();
  const named = nameIdentities(rows, parent);
  // One position never names two assets, even through rows that each name one: joining them
  // would merge two securities.
  if (!named || !onePositionOneAsset(named)) return { ok: false, reason: 'invalid_response' };
  const groupOf = (instrumentUid: string) =>
    named.positionUid.has(instrumentUid) || named.assetUid.has(instrumentUid)
      ? rootOf(parent, `instrument:${instrumentUid}`)
      : undefined;
  const groups = groupRows(rows, groupOf);
  if (!groups) return { ok: false, reason: 'invalid_response' };
  for (const row of positions) {
    if (row.virtual || !security(row)) continue;
    const id = groupOf(row.instrumentUid);
    if (id) groups.get(id)!.held.add(row.instrumentUid);
  }
  if (!typesAgree(rows, groups, groupOf)) return { ok: false, reason: 'invalid_response' };
  const canonical = canonicalUids(groups, named);
  if (!canonical) return { ok: false, reason: 'invalid_response' };
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

/**
 * The position and asset each security's instrument names, with every instrument joined in
 * `parent` to what it names; null when an instrument names two of either.
 */
function nameIdentities(rows: readonly Row[], parent: Map<string, string>): Named | null {
  const join = (a: string, b: string) => {
    const [x, y] = [rootOf(parent, a), rootOf(parent, b)].sort();
    if (x !== y) parent.set(y, x);
  };
  const named: Named = { positionUid: new Map(), assetUid: new Map() };
  for (const row of rows) {
    if (!security(row) || !row.instrumentUid) continue;
    for (const key of ['positionUid', 'assetUid'] as const) {
      const value = (row as { positionUid?: string; assetUid?: string })[key];
      if (!value) continue;
      const previous = named[key].get(row.instrumentUid);
      if (previous && previous !== value) return null;
      named[key].set(row.instrumentUid, value);
      join(`${key}:${value}`, `instrument:${row.instrumentUid}`);
    }
  }
  return named;
}

function onePositionOneAsset(named: Named): boolean {
  const assetOfPosition = new Map<string, string>();
  for (const [instrument, position] of named.positionUid) {
    const asset = named.assetUid.get(instrument);
    if (!asset) continue;
    const previous = assetOfPosition.get(position);
    if (previous && previous !== asset) return false;
    assetOfPosition.set(position, asset);
  }
  return true;
}

/** The security rows of each holding; null when one holding's rows differ in kind. */
function groupRows(
  rows: readonly Row[],
  groupOf: (instrumentUid: string) => string | undefined,
): Map<string, Group> | null {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (!security(row)) continue;
    const id = groupOf(row.instrumentUid);
    if (!id) continue;
    const group = groups.get(id) ?? { type: row.instrumentType, ids: new Set(), held: new Set() };
    if (group.type !== row.instrumentType) return null;
    group.ids.add(row.instrumentUid);
    groups.set(id, group);
  }
  return groups;
}

/** Whether no row of a holding, security or not, names another kind than the holding's. */
function typesAgree(
  rows: readonly Row[],
  groups: ReadonlyMap<string, Group>,
  groupOf: (instrumentUid: string) => string | undefined,
): boolean {
  for (const row of rows) {
    const id = groupOf(row.instrumentUid);
    if (id && row.instrumentType && row.instrumentType !== groups.get(id)?.type) return false;
  }
  return true;
}

/** The instrument UID each holding is known by; null when its held rows might be duplicates. */
function canonicalUids(
  groups: ReadonlyMap<string, Group>,
  named: Named,
): Map<string, string> | null {
  const canonical = new Map<string, string>();
  for (const [id, group] of groups) {
    // Two current rows of one position, or of no named position, might be duplicated holdings;
    // never sum them on an identity guess. Rows of distinct positions (one asset on two venues)
    // are both held.
    const heldPositions = [...group.held].map((uid) => named.positionUid.get(uid));
    if (
      group.held.size > 1 &&
      (heldPositions.includes(undefined) || new Set(heldPositions).size < group.held.size)
    )
      return null;
    canonical.set(id, [...group.held].sort()[0] ?? [...group.ids].sort()[0]);
  }
  return canonical;
}

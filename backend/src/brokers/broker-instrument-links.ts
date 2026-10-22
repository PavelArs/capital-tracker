import type { TBankOperation, TBankPosition } from './tbank-client';

/** An owner's saved T-Bank link, with the asset and security type T-Bank named when it was made. */
export interface SavedLink {
  uid: string;
  assetUid: string | null;
  instrumentType: string | null;
  id: string;
  name: string;
  symbol: string | null;
}

/** What this history says about one instrument: its original UIDs, asset and security type. */
export interface InstrumentFacts {
  uids: Set<string>;
  assetUid?: string;
  instrumentType?: string;
}

const securityTypes = ['share', 'bond', 'etf'];

/** The facts of each wanted canonical UID; undefined when T-Bank names two assets or types. */
export function instrumentFacts(
  wanted: Iterable<string>,
  rows: readonly (TBankOperation | TBankPosition)[],
): Map<string, InstrumentFacts> | undefined {
  const facts = new Map<string, InstrumentFacts>(
    [...wanted].map((uid) => [uid, { uids: new Set([uid]) }]),
  );
  for (const row of rows) {
    const fact = facts.get(row.instrumentUid);
    if (!fact) continue;
    if (row.providerInstrumentUid) fact.uids.add(row.providerInstrumentUid);
    const named = {
      assetUid: 'assetUid' in row ? row.assetUid : undefined,
      instrumentType: securityTypes.includes(row.instrumentType) ? row.instrumentType : undefined,
    };
    for (const key of ['assetUid', 'instrumentType'] as const) {
      const value = named[key];
      if (!value) continue;
      if (fact[key] && fact[key] !== value) return undefined;
      fact[key] = value;
    }
  }
  return facts;
}

/**
 * The saved instrument each wanted UID resolves to: by any of its original UIDs, or by its asset,
 * so one fund on two venues is one instrument across accounts. Undefined when the links disagree
 * (two instruments, another asset or security type, or two holdings on one instrument); the
 * caller refuses rather than guesses.
 */
export function resolveLinks(
  facts: ReadonlyMap<string, InstrumentFacts>,
  saved: readonly SavedLink[],
): Map<string, SavedLink> | undefined {
  const resolved = new Map<string, SavedLink>();
  const taken = new Set<string>();
  for (const [uid, fact] of facts) {
    const matches = saved.filter(
      (row) => fact.uids.has(row.uid) || (!!fact.assetUid && row.assetUid === fact.assetUid),
    );
    const differs = (row: SavedLink, key: 'assetUid' | 'instrumentType') =>
      !!fact[key] && !!row[key] && row[key] !== fact[key];
    if (
      new Set(matches.map((row) => row.id)).size > 1 ||
      matches.some((row) => differs(row, 'assetUid') || differs(row, 'instrumentType'))
    )
      return undefined;
    const row = matches[0];
    if (!row) continue;
    if (taken.has(row.id)) return undefined;
    taken.add(row.id);
    resolved.set(uid, row);
  }
  return resolved;
}

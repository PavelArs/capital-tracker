import { chainAsset, networkNames } from '../wallet-addresses/chain-assets';

// audit-history (M27, BR 14): who changed what and when, read from the immutable version
// rows every journal already keeps. Nothing is stored for this screen; each version of a
// trade, transfer, swap, reward, external flow, manual price or chain classification is one
// event, compared with the version before it.

export const auditEntities = [
  'trade',
  'transfer',
  'swap',
  'reward',
  'flow',
  'price',
  'classification',
] as const;
export type AuditEntity = (typeof auditEntities)[number];

export const auditChanges = ['created', 'changed', 'deleted'] as const;
export type AuditChange = (typeof auditChanges)[number];

/** Who made the version: the owner, an import of a CSV file, or the app itself (sync, D7). */
export const auditActors = ['owner', 'csv', 'automatic'] as const;
export type AuditActor = (typeof auditActors)[number];

export type AuditFieldKind = 'text' | 'quantity' | 'usd' | 'moment';

/** One value of a version; `unit` names what a quantity counts ("BTC", "RUB"). */
export interface AuditValue {
  kind: AuditFieldKind;
  value: string;
  unit: string | null;
}

export interface AuditField {
  label: string;
  /** Null when the version brought the value in (created). */
  before: AuditValue | null;
  /** Null when the version took the value away (deleted). */
  after: AuditValue | null;
}

export interface AuditEvent {
  id: string;
  /** When the version was written. */
  at: string;
  entity: AuditEntity;
  entityId: string;
  version: number;
  change: AuditChange;
  actor: AuditActor;
  title: string;
  /** The ticker of the asset the operation moves, when it has one. */
  asset: string | null;
  account: string | null;
  /** When the operation itself happened (its own date, not when it was edited). */
  occurredAt: string | null;
  fields: AuditField[];
}

/** One version as the database returns it; `snapshot` and `previous` are the version's facts. */
export interface AuditRow {
  entity: AuditEntity;
  entityId: string;
  version: number;
  change: AuditChange;
  actor: AuditActor;
  createdAt: Date;
  occurredAt: Date | null;
  account: string | null;
  snapshot: Snapshot;
  previous: Snapshot | null;
}

type Snapshot = Record<string, string | null>;

/** Decimal text without trailing zeros: "0.500000000000000000000000000000" is "0.5". */
export function trimDecimal(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

const text = (value: string | null | undefined): AuditValue | null =>
  value === null || value === undefined || value === ''
    ? null
    : { kind: 'text', value, unit: null };
const moment = (value: string | null | undefined): AuditValue | null =>
  value ? { kind: 'moment', value, unit: null } : null;
const usd = (value: string | null | undefined): AuditValue | null =>
  value === null || value === undefined
    ? null
    : { kind: 'usd', value: trimDecimal(value), unit: null };
const quantity = (
  value: string | null | undefined,
  unit: string | null | undefined,
): AuditValue | null =>
  value === null || value === undefined
    ? null
    : { kind: 'quantity', value: trimDecimal(value), unit: unit ?? null };
/** A fee of zero is no fee. */
const fee = (value: string | null | undefined, unit: string | null | undefined) =>
  value === null || value === undefined || Number(value) === 0 ? null : quantity(value, unit);

/** "staking-reward" is "Staking reward". */
export function humanize(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const statusNames: Record<string, string> = {
  unclassified: 'Needs classification',
  classified: 'Classified',
  hidden: 'Hidden',
};
const directionNames: Record<string, string> = {
  in: 'Incoming',
  out: 'Outgoing',
  self: 'Internal',
  internal: 'Internal',
};

/** The ticker a stored chain leg is named by; an unknown token keeps its stored name. */
export function legSymbol(network: string | null, token: string | null): string | null {
  if (!network) return token;
  try {
    return chainAsset(network, token).symbol;
  } catch {
    return token;
  }
}

type Fields = [label: string, value: AuditValue | null][];

function tradeFields(s: Snapshot): Fields {
  return [
    ['Side', text(s.side ? humanize(s.side) : null)],
    ['Quantity', quantity(s.quantity, s.asset)],
    ['Amount', usd(s.grossUsd)],
    ['Fee', usd(s.feeUsd)],
    ['Paid', s.paidCurrency ? quantity(s.paidGross, s.paidCurrency) : null],
    ['Date', moment(s.occurredAt)],
    ['Comment', text(s.comment)],
  ];
}
function transferFields(s: Snapshot): Fields {
  return [
    ['Quantity', quantity(s.quantity, s.asset)],
    ['To', text(s.to)],
    ['Fee', fee(s.feeQuantity, s.feeAsset)],
    ['Date', moment(s.occurredAt)],
  ];
}
function swapFields(s: Snapshot): Fields {
  return [
    ['Gave', quantity(s.gave, s.gaveAsset)],
    ['Got', quantity(s.got, s.gotAsset)],
    ['Value', usd(s.considerationUsd)],
    ['Fee', fee(s.feeQuantity, s.feeAsset)],
    ['Date', moment(s.occurredAt)],
  ];
}
function rewardFields(s: Snapshot): Fields {
  return [
    ['Category', text(s.category ? humanize(s.category) : null)],
    ['Quantity', quantity(s.quantity, s.asset)],
    ['Income value', usd(s.incomeValueUsd)],
    ['Cost basis', usd(s.acquisitionBasisUsd)],
    ['Date', moment(s.occurredAt)],
  ];
}
function flowFields(s: Snapshot): Fields {
  return [
    ['Direction', text(s.direction ? humanize(s.direction) : null)],
    ['Amount', usd(s.amountUsd)],
    ['Date', moment(s.occurredAt)],
  ];
}
function priceFields(s: Snapshot): Fields {
  return [
    ['Price', usd(s.price)],
    ['Price date', moment(s.occurredAt)],
  ];
}
function classificationFields(s: Snapshot): Fields {
  return [
    ['Status', text(s.status ? (statusNames[s.status] ?? humanize(s.status)) : null)],
    ['Type', text(s.type ? humanize(s.type) : null)],
    ['Comment', text(s.comment)],
  ];
}
const fieldsOf: Record<AuditEntity, (snapshot: Snapshot) => Fields> = {
  trade: tradeFields,
  transfer: transferFields,
  swap: swapFields,
  reward: rewardFields,
  flow: flowFields,
  price: priceFields,
  classification: classificationFields,
};

const same = (left: AuditValue | null, right: AuditValue | null) =>
  left === null || right === null
    ? left === right
    : left.kind === right.kind && left.value === right.value && left.unit === right.unit;

/**
 * The fields a version brought in (created), took away (deleted) or changed, in the order the
 * screen shows them. A created or deleted version lists everything it holds; a deleted one
 * shows what the previous version held, because a void repeats nothing the owner entered.
 */
export function auditFields(row: AuditRow): AuditField[] {
  const read = fieldsOf[row.entity];
  if (row.change === 'created' || !row.previous)
    return read(row.snapshot).flatMap(([label, after]) =>
      after ? [{ label, before: null, after }] : [],
    );
  const before = read(row.previous);
  if (row.change === 'deleted')
    return before.flatMap(([label, value]) =>
      value ? [{ label, before: value, after: null }] : [],
    );
  const after = read(row.snapshot);
  const changed = before.flatMap(([label, old], index) => {
    const current = after[index]?.[1] ?? null;
    return same(old, current) ? [] : [{ label, before: old, after: current }];
  });
  // The amounts of a classification are many; the screen only says they were updated.
  const { details } = row.snapshot;
  if (
    row.entity === 'classification' &&
    details &&
    row.previous.details &&
    row.previous.details !== details
  )
    changed.push({ label: 'Details', before: text('Recorded'), after: text('Updated') });
  return changed;
}

function titleOf(row: AuditRow): { title: string; asset: string | null } {
  const s = row.snapshot;
  switch (row.entity) {
    case 'trade':
      return { title: `${humanize(s.side ?? 'trade')} ${s.asset ?? ''}`.trim(), asset: s.asset };
    case 'transfer':
      return { title: `Transfer ${s.asset ?? ''}`.trim(), asset: s.asset };
    case 'swap':
      return { title: `Swap ${s.gaveAsset ?? ''} → ${s.gotAsset ?? ''}`, asset: s.gaveAsset };
    case 'reward':
      return { title: `Reward ${s.asset ?? ''}`.trim(), asset: s.asset };
    case 'flow':
      return { title: s.direction === 'withdrawal' ? 'Withdrawal' : 'Deposit', asset: null };
    case 'price':
      return { title: `Manual price ${s.asset ?? ''}`.trim(), asset: s.asset };
    case 'classification': {
      const symbol = legSymbol(s.network, s.asset);
      return {
        title: `${directionNames[s.direction ?? ''] ?? 'Blockchain'} ${symbol ?? ''}`.trim(),
        asset: symbol,
      };
    }
  }
}

/** The place a classification belongs to: its account, else the wallet's network. */
function placeOf(row: AuditRow): string | null {
  if (row.account) return row.account;
  const network = row.snapshot.network;
  if (row.entity === 'classification' && network)
    return `${networkNames[network as keyof typeof networkNames] ?? humanize(network)} wallet`;
  return null;
}

export function projectEvent(row: AuditRow): AuditEvent {
  // A void names the operation after the version it deletes.
  const identity = titleOf(
    row.change === 'deleted' && row.previous ? { ...row, snapshot: row.previous } : row,
  );
  return {
    id: auditKey(row),
    at: row.createdAt.toISOString(),
    entity: row.entity,
    entityId: row.entityId,
    version: row.version,
    change: row.change,
    actor: row.actor,
    title: identity.title,
    asset: identity.asset,
    account: placeOf(row),
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    fields: auditFields(row),
  };
}

/** Stable identity of one version; also the tie-break of the newest-first order. */
export function auditKey(row: Pick<AuditRow, 'entity' | 'entityId' | 'version'>): string {
  return `${row.entity}:${row.entityId}:${String(row.version).padStart(6, '0')}`;
}

export interface AuditFilter {
  entity: AuditEntity | null;
  change: AuditChange | null;
  actor: AuditActor | null;
  /** Inclusive UTC days of the change, "YYYY-MM-DD". */
  from: string | null;
  to: string | null;
  limit: number;
  before: { at: string; key: string } | null;
}

export interface AuditHistory {
  at: string;
  events: AuditEvent[];
  /** Pass back as `before` for the next older page; null at the end. */
  next: string | null;
}

const maxLimit = 200;
const defaultLimit = 50;
const day = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('invalid');
  return value as T;
}
function dayOf(value: unknown): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !day.test(value)) throw new Error('invalid');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error('invalid');
  return value;
}

/** Cursor text of the last event of a page: its write time and key. */
export function encodeCursor(event: Pick<AuditEvent, 'at' | 'id'>): string {
  return Buffer.from(JSON.stringify([event.at, event.id]), 'utf8').toString('base64url');
}
function decodeCursor(value: unknown): { at: string; key: string } | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 512) throw new Error('invalid');
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    Number.isNaN(new Date(parsed[0]).getTime())
  )
    throw new Error('invalid');
  return { at: new Date(parsed[0]).toISOString(), key: parsed[1] };
}

const allowedKeys = ['entity', 'change', 'actor', 'from', 'to', 'limit', 'before'];

/** Throws a plain Error for any query the screen would never send. */
export function parseAuditQuery(raw: unknown): AuditFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
  const query = raw as Record<string, unknown>;
  if (Object.keys(query).some((key) => !allowedKeys.includes(key))) throw new Error('invalid');
  const limit =
    query.limit === undefined || query.limit === ''
      ? defaultLimit
      : typeof query.limit === 'string' && /^\d{1,3}$/.test(query.limit)
        ? Number(query.limit)
        : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new Error('invalid');
  const from = dayOf(query.from);
  const to = dayOf(query.to);
  if (from && to && from > to) throw new Error('invalid');
  return {
    entity: oneOf(query.entity, auditEntities),
    change: oneOf(query.change, auditChanges),
    actor: oneOf(query.actor, auditActors),
    from,
    to,
    limit,
    before: decodeCursor(query.before),
  };
}

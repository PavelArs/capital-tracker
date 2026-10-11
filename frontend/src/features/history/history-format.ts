import type {
  AuditActor,
  AuditChange,
  AuditEntity,
  AuditEvent,
  AuditField,
  AuditValue,
} from '@api/audit-history.api';
import { money, quantity } from '../portfolio/format';
import { moment } from '../transactions/operation-format';

export const changeLabels: Record<AuditChange, string> = {
  created: 'Created',
  changed: 'Changed',
  deleted: 'Deleted',
};

export const actorLabels: Record<AuditActor, string> = {
  owner: 'You',
  csv: 'CSV import',
  automatic: 'Automatic',
};

export const entityLabels: Record<AuditEntity, string> = {
  trade: 'Buys and sells',
  transfer: 'Transfers',
  swap: 'Swaps',
  reward: 'Rewards',
  flow: 'Deposits and withdrawals',
  price: 'Manual prices',
  classification: 'Blockchain answers',
};

/** One stored value as the owner reads it. */
export function valueText(value: AuditValue): string {
  switch (value.kind) {
    case 'quantity':
      return value.unit ? `${quantity(value.value)} ${value.unit}` : quantity(value.value);
    case 'usd':
      return money(value.value, 'USD');
    case 'moment':
      return moment(value.value);
    default:
      return value.value;
  }
}

/** "Amount: $30,000 → $31,000", "Comment: added Fixed", "Side: Buy" for one field. */
export function fieldText(field: AuditField): string {
  const { before, after } = field;
  if (before && after) return `${field.label}: ${valueText(before)} → ${valueText(after)}`;
  if (after) return `${field.label}: ${valueText(after)}`;
  if (before) return `${field.label}: ${valueText(before)}`;
  return field.label;
}

// The facts worth a line of the list; dates and comments are in the drawer.
const headline = (field: AuditField) => field.label !== 'Date' && field.label !== 'Comment';

/** One line for the list: what changed, or the main facts of a created or deleted entry. */
export function summary(event: AuditEvent): string {
  if (event.change === 'changed') {
    if (event.fields.length === 0) return 'No visible field changed';
    const [first, ...rest] = event.fields;
    return rest.length > 0 ? `${fieldText(first)} +${rest.length} more` : fieldText(first);
  }
  const facts = event.fields.filter(headline).slice(0, 2);
  const text = facts
    .flatMap((field) => {
      const value = event.change === 'deleted' ? field.before : field.after;
      return value ? [`${field.label} ${valueText(value)}`] : [];
    })
    .join(' · ');
  return text || (event.change === 'deleted' ? 'Removed from calculations' : 'Recorded');
}

/** The type mark of a row: a cart for a buy, arrows for a transfer or swap, and so on. */
export function glyphOf(
  event: AuditEvent,
): 'buy' | 'sell' | 'move' | 'reward' | 'in' | 'out' | 'opening' | 'chain' {
  switch (event.entity) {
    case 'trade':
      return event.title.startsWith('Sell') ? 'sell' : 'buy';
    case 'transfer':
    case 'swap':
      return 'move';
    case 'reward':
      return 'reward';
    case 'flow':
      return event.title === 'Withdrawal' ? 'out' : 'in';
    case 'price':
      return 'opening';
    default:
      return 'chain';
  }
}

import type {
  AuditActor,
  AuditChange,
  AuditEntity,
  AuditEvent,
  AuditField,
  AuditValue,
} from '@api/audit-history.api';
import { dayText, localDate } from '@utils/dates';
import type { BadgeTone } from '@/ui/Badge';
import { money, quantity } from '../portfolio/format';
import { moment } from '../transactions/operation-format';

export const changeLabels: Record<AuditChange, string> = {
  created: 'Created',
  changed: 'Changed',
  deleted: 'Deleted',
};

export const changeTones: Record<AuditChange, BadgeTone> = {
  created: 'pos',
  changed: 'neutral',
  deleted: 'neg',
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
  deposit: 'Bank deposits',
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
  // A bank deposit event lists its own facts: "Top-up added · 5,000.5 RUB".
  if (event.entity === 'deposit') {
    const facts = event.fields.filter(headline).slice(0, 2);
    return facts
      .flatMap((field) => {
        const value = event.change === 'deleted' ? field.before : field.after;
        return value ? [valueText(value)] : [];
      })
      .join(' · ');
  }
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
    case 'deposit':
      return 'opening';
    default:
      return 'chain';
  }
}

/**
 * The local day a change was made, as its time is shown: Today, Yesterday or "Oct 2, 2026".
 * A change is a moment, not an accounting day, so it is dated in the browser's zone.
 */
export function localDayHeading(iso: string, now: string): string {
  const day = localDate(iso);
  const days = Math.round((Date.parse(localDate(now)) - Date.parse(day)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dayText(day);
}

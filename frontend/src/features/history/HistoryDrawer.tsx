import type { AuditEvent } from '@api/audit-history.api';
import { useRef } from 'react';
import { AmountHero } from '@/ui/AmountHero';
import Badge from '@/ui/Badge';
import Drawer, { DrawerHeader } from '@/ui/Drawer';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import { moment } from '../transactions/operation-format';
import { actorLabels, changeLabels, changeTones, valueText } from './history-format';
import './history.css';

/** Side drawer of one stored version: when, who, and each value before and after. */
export default function HistoryDrawer({
  event,
  onClose,
}: {
  event: AuditEvent;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const facts: [string, string][] = [
    ['Version', `${event.version}`],
    ...(event.account
      ? [[event.entity === 'deposit' ? 'Bank' : 'Account', event.account] as [string, string]]
      : []),
    // A bank deposit event states its own day among its facts.
    ...(event.occurredAt && event.entity !== 'deposit'
      ? [['Operation date', moment(event.occurredAt)] as [string, string]]
      : []),
  ];
  return (
    <Drawer titleId="history-title" onClose={onClose} initialFocus={() => closeButton.current}>
      <DrawerHeader
        titleId="history-title"
        title={event.title}
        onClose={onClose}
        closeRef={closeButton}
      />
      <div className="ui-drawer__body">
        <AmountHero
          badge={<Badge tone={changeTones[event.change]}>{changeLabels[event.change]}</Badge>}
          amount={moment(event.at)}
          detail={actorLabels[event.actor]}
        />
        <section aria-labelledby="history-changes">
          <h3 id="history-changes" className="history-section">
            {event.entity === 'deposit'
              ? 'What happened'
              : event.change === 'changed'
                ? 'What changed'
                : event.change === 'created'
                  ? 'What was recorded'
                  : 'What was removed'}
          </h3>
          {event.fields.length === 0 ? (
            <p className="ui-sub">
              This version was written without a visible difference from the one before it.
            </p>
          ) : (
            <KeyValue>
              {event.fields.map((field) => (
                <KeyValueRow key={field.label} term={field.label}>
                  {field.before && field.after ? (
                    <span className="history-change">
                      <span className="history-old">{valueText(field.before)}</span>
                      <span className="history-arrow" aria-label="became">
                        →
                      </span>
                      <span>{valueText(field.after)}</span>
                    </span>
                  ) : field.after ? (
                    <span>{valueText(field.after)}</span>
                  ) : field.before ? (
                    <span className="history-old">{valueText(field.before)}</span>
                  ) : null}
                </KeyValueRow>
              ))}
            </KeyValue>
          )}
        </section>
        <section aria-label="Details">
          <KeyValue>
            {facts.map(([label, value]) => (
              <KeyValueRow key={label} term={label}>
                {value}
              </KeyValueRow>
            ))}
          </KeyValue>
        </section>
        <p className="ui-sub">
          Every change is kept as a new version; earlier versions are never overwritten.
        </p>
      </div>
    </Drawer>
  );
}

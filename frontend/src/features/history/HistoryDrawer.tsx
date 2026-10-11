import type { AuditEvent } from '@api/audit-history.api';
import { useRef } from 'react';
import Badge from '@/ui/Badge';
import Drawer from '@/ui/Drawer';
import AssetIcon from '../shell/AssetIcon';
import CloseButton from '../shell/CloseButton';
import { moment } from '../transactions/operation-format';
import { Glyph } from '../transactions/TypeIcon';
import { actorLabels, changeLabels, changeTones, glyphOf, valueText } from './history-format';
import '../transactions/transactions.css';
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
    ...(event.account ? [['Account', event.account] as [string, string]] : []),
    ...(event.occurredAt ? [['Operation date', moment(event.occurredAt)] as [string, string]] : []),
  ];
  return (
    <Drawer titleId="history-title" onClose={onClose} initialFocus={() => closeButton.current}>
      <div className="ui-drawer__head">
        <h2 id="history-title">{event.title}</h2>
        <CloseButton buttonRef={closeButton} onClick={onClose} />
      </div>
      <div className="ui-drawer__body">
        <div className="transactions-hero">
          <Badge tone={changeTones[event.change]}>{changeLabels[event.change]}</Badge>
          <span className="history-hero">
            {event.asset ? (
              <AssetIcon symbol={event.asset} name={event.asset} />
            ) : (
              <span className="transactions-type-icon">
                <Glyph name={glyphOf(event)} />
              </span>
            )}
            <span className="transactions-hero__value">
              {moment(event.at)} · {actorLabels[event.actor]}
            </span>
          </span>
        </div>
        <section aria-labelledby="history-changes">
          <h3 id="history-changes" className="transactions-section">
            {event.change === 'changed'
              ? 'What changed'
              : event.change === 'created'
                ? 'What was recorded'
                : 'What was removed'}
          </h3>
          {event.fields.length === 0 ? (
            <p className="transactions-info">
              This version was written without a visible difference from the one before it.
            </p>
          ) : (
            <dl className="history-fields">
              {event.fields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.before && field.after ? (
                      <>
                        <span className="history-old">{valueText(field.before)}</span>
                        <span className="history-arrow" aria-label="became">
                          →
                        </span>
                        <span>{valueText(field.after)}</span>
                      </>
                    ) : field.after ? (
                      <span>{valueText(field.after)}</span>
                    ) : field.before ? (
                      <span className="history-old">{valueText(field.before)}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section aria-label="Details">
          <dl className="transactions-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <p className="transactions-info">
          Every change is kept as a new version; earlier versions are never overwritten.
        </p>
      </div>
    </Drawer>
  );
}

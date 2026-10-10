import {
  type AuditActor,
  type AuditChange,
  type AuditEntity,
  type AuditEvent,
  type AuditHistory,
  type AuditQuery,
  auditHistoryApi,
} from '@api/audit-history.api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AssetIcon from '../shell/AssetIcon';
import PageHeader from '../shell/PageHeader';
import { dayHeading, time } from '../transactions/operation-format';
import { Glyph } from '../transactions/TypeIcon';
import { useNarrowScreen } from '../transactions/useNarrowScreen';
import HistoryDrawer from './HistoryDrawer';
import { actorLabels, changeLabels, entityLabels, glyphOf, summary } from './history-format';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import '../transactions/transactions.css';
import './history.css';

const changes = Object.keys(changeLabels) as AuditChange[];
const entities = Object.keys(entityLabels) as AuditEntity[];
const actors = Object.keys(actorLabels) as AuditActor[];
const oneOf = <T extends string>(allowed: T[], value: string | null): T | undefined =>
  allowed.find((item) => item === value);
const isDay = (value: string | null): value is string =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);

function Mark({ event }: { event: AuditEvent }) {
  return event.asset ? (
    <AssetIcon symbol={event.asset} name={event.asset} size="sm" />
  ) : (
    <span className="transactions-type-icon">
      <Glyph name={glyphOf(event)} />
    </span>
  );
}

function Badge({ change }: { change: AuditChange }) {
  return <span className={`history-badge history-badge--${change}`}>{changeLabels[change]}</span>;
}

function Row({
  event,
  current,
  onOpen,
}: {
  event: AuditEvent;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <tr
      className={current ? 'transactions-row--open' : undefined}
      data-event={event.id}
      aria-current={current || undefined}
      onClick={onOpen}
    >
      <td className="portfolio-num history-when">{time(event.at).replace(' UTC', '')}</td>
      <td>
        <Badge change={event.change} />
      </td>
      <td className="transactions-wrap">
        <span className="transactions-type">
          <Mark event={event} />
          <span>
            <button
              type="button"
              className="transactions-open"
              onClick={(click) => {
                click.stopPropagation();
                onOpen();
              }}
            >
              {event.title}
            </button>
            <span className="portfolio-sub">{event.account ?? 'No account'}</span>
          </span>
        </span>
      </td>
      <td className="transactions-wrap">{summary(event)}</td>
      <td>{actorLabels[event.actor]}</td>
    </tr>
  );
}

// Phones: one tappable two-line row per version; the full comparison is in the drawer.
function Item({
  event,
  current,
  onOpen,
}: {
  event: AuditEvent;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <li data-event={event.id} aria-current={current || undefined}>
      <button
        type="button"
        className={`transactions-item${current ? ' transactions-item--open' : ''}`}
        onClick={onOpen}
      >
        <Mark event={event} />
        <span className="transactions-item__main">
          <span className="transactions-item__title">{event.title}</span>
          <span className="transactions-item__detail">{summary(event)}</span>
        </span>
        <span className="transactions-item__side">
          <span className="transactions-item__amount">{changeLabels[event.change]}</span>
          <span className="transactions-item__value">
            {time(event.at).replace(' UTC', '')} · {actorLabels[event.actor]}
          </span>
        </span>
      </button>
    </li>
  );
}

// Who changed what and when (BR 14): every stored version of the journals, newest first.
export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const entity = oneOf(entities, params.get('entity'));
  const change = oneOf(changes, params.get('change'));
  const actor = oneOf(actors, params.get('actor'));
  const from = isDay(params.get('from')) ? params.get('from') : null;
  const to = isDay(params.get('to')) ? params.get('to') : null;
  // Only the filters that are set, so the request carries no empty parameter.
  const query = useMemo(
    (): AuditQuery => ({
      ...(entity && { entity }),
      ...(change && { change }),
      ...(actor && { actor }),
      ...(from && { from }),
      ...(to && { to }),
    }),
    [entity, change, actor, from, to],
  );
  const [history, setHistory] = useState<AuditHistory | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [failed, setFailed] = useState<'load' | 'more' | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const latest = useRef(0);
  const narrow = useNarrowScreen();

  // A changed filter keeps the rows on screen until the new ones arrive, so the filters stay
  // under the owner's hand.
  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(null);
    setLoadingMore(false);
    try {
      const page = await auditHistoryApi.list(query);
      if (request !== latest.current) return;
      setHistory(page);
      setEvents(page.events);
    } catch {
      if (request === latest.current) setFailed('load');
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    if (!history?.next) return;
    const request = ++latest.current;
    setLoadingMore(true);
    setFailed(null);
    try {
      const page = await auditHistoryApi.list(query, history.next);
      if (request !== latest.current) return;
      setHistory(page);
      setEvents((shown) => [...shown, ...page.events]);
    } catch {
      if (request === latest.current) setFailed('more');
    } finally {
      if (request === latest.current) setLoadingMore(false);
    }
  };

  // The router commits an address change later; a second change before that builds on the
  // first one, not on the address it replaces.
  const pending = useRef<{ from: URLSearchParams; next: URLSearchParams } | null>(null);
  const replaceParams = (next: URLSearchParams) => {
    pending.current = { from: params, next };
    setOpenId(null);
    setParams(next, { replace: true });
  };
  const update = (changes: Record<string, string>) => {
    const base = pending.current?.from === params ? pending.current.next : params;
    const next = new URLSearchParams(base);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    replaceParams(next);
  };
  const filtered = Boolean(entity || change || actor || from || to);
  const opened = events.find((event) => event.id === openId) ?? null;

  // One group per UTC day of the change, under a heading as in Transactions.
  const days: { heading: string; events: AuditEvent[] }[] = [];
  for (const event of events) {
    const heading = dayHeading(event.at, history?.at ?? event.at);
    const last = days.at(-1);
    if (last?.heading === heading) last.events.push(event);
    else days.push({ heading, events: [event] });
  }

  return (
    <div className="shell-page">
      <PageHeader
        title="History"
        actions={
          <Link className="shell-button shell-button--ghost" to="/preferences">
            Back to Settings
          </Link>
        }
      />
      {failed === 'load' && history === null ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load the change history. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : history === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading the change history…
        </section>
      ) : events.length === 0 && !filtered ? (
        <section className="shell-card shell-empty" aria-labelledby="history-empty">
          <h2 id="history-empty">Nothing has changed yet</h2>
          <p>
            Every transaction you add, correct or delete, and every answer to a blockchain
            transaction, is listed here with the time it happened.
          </p>
        </section>
      ) : (
        <section className="shell-card" aria-label="Change history">
          <div className="portfolio-toolbar">
            <div className="portfolio-chips" role="group" aria-label="Filter by change">
              <button
                type="button"
                className="portfolio-chip"
                aria-pressed={!change}
                onClick={() => update({ change: '' })}
              >
                All
              </button>
              {changes.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="portfolio-chip"
                  aria-pressed={change === key}
                  onClick={() => update({ change: key })}
                >
                  {changeLabels[key]}
                </button>
              ))}
            </div>
            <div className="transactions-filters">
              <label className="transactions-filter">
                <span>Type</span>
                <select
                  value={entity ?? ''}
                  onChange={(event) => update({ entity: event.target.value })}
                >
                  <option value="">All types</option>
                  {entities.map((key) => (
                    <option key={key} value={key}>
                      {entityLabels[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="transactions-filter">
                <span>Source</span>
                <select
                  value={actor ?? ''}
                  onChange={(event) => update({ actor: event.target.value })}
                >
                  <option value="">Any source</option>
                  {actors.map((key) => (
                    <option key={key} value={key}>
                      {actorLabels[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="transactions-filter">
                <span>From</span>
                <input
                  className="history-date"
                  type="date"
                  value={from ?? ''}
                  max={to ?? undefined}
                  onChange={(event) => update({ from: event.target.value })}
                />
              </label>
              <label className="transactions-filter">
                <span>To</span>
                <input
                  className="history-date"
                  type="date"
                  value={to ?? ''}
                  min={from ?? undefined}
                  onChange={(event) => update({ to: event.target.value })}
                />
              </label>
            </div>
          </div>
          {events.length === 0 ? (
            <div className="portfolio-none transactions-none">
              <p>No changes match</p>
              <button
                type="button"
                className="shell-button"
                onClick={() => replaceParams(new URLSearchParams())}
              >
                Clear filters
              </button>
            </div>
          ) : narrow ? (
            <ol className="transactions-list" aria-label="Changes">
              {days.map((group) => (
                <li key={group.heading} className="transactions-list__day">
                  <h2 className="transactions-list__heading">{group.heading}</h2>
                  <ul>
                    {group.events.map((event) => (
                      <Item
                        key={event.id}
                        event={event}
                        current={event.id === openId}
                        onOpen={() => setOpenId(event.id)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <div className="portfolio-table-wrap">
              <table
                className="portfolio-table transactions-table history-table"
                aria-label="Changes"
              >
                <colgroup>
                  <col className="history-col--when" />
                  <col className="history-col--change" />
                  <col className="history-col--operation" />
                  <col className="history-col--what" />
                  <col className="history-col--source" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="portfolio-num">
                      Time
                    </th>
                    <th scope="col">Change</th>
                    <th scope="col">Transaction</th>
                    <th scope="col">What changed</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                {days.map((group) => (
                  <tbody key={group.heading}>
                    <tr className="transactions-day">
                      <th scope="rowgroup" colSpan={5}>
                        {group.heading}
                      </th>
                    </tr>
                    {group.events.map((event) => (
                      <Row
                        key={event.id}
                        event={event}
                        current={event.id === openId}
                        onOpen={() => setOpenId(event.id)}
                      />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {failed && (
            <p className="portfolio-dialog__error" role="alert">
              {failed === 'more'
                ? 'Could not load older changes.'
                : 'Could not load the changes for these filters.'}{' '}
              <button
                type="button"
                className="shell-button shell-button--ghost"
                onClick={() => void (failed === 'more' ? more() : load())}
              >
                Try again
              </button>
            </p>
          )}
          {history.next && (
            <div className="history-more">
              <button
                type="button"
                className="shell-button"
                disabled={loadingMore}
                onClick={() => void more()}
              >
                {loadingMore ? 'Loading…' : 'Show older changes'}
              </button>
            </div>
          )}
          <p className="shell-note portfolio-note">
            {events.length} {events.length === 1 ? 'change' : 'changes'} shown, newest first. Every
            change is kept as a new version, so nothing is overwritten; deleting a transaction adds
            a version that removes it from your calculations. Blockchain transactions are never
            deleted, only classified or hidden. Times are in UTC.
          </p>
        </section>
      )}
      {opened && <HistoryDrawer event={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}

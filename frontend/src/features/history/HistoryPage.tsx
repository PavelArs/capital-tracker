import {
  type AuditActor,
  type AuditChange,
  type AuditEntity,
  type AuditEvent,
  type AuditHistory,
  type AuditQuery,
} from '@api/audit-history.api';
import { cachedReads } from '@api/cached-reads';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import AssetIcon from '../shell/AssetIcon';
import LoadMore, { PAGE_SIZE } from '../shell/InfiniteScroll';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { dayHeading, time } from '../transactions/operation-format';
import { Glyph } from '../transactions/TypeIcon';
import HistoryDrawer from './HistoryDrawer';
import {
  actorLabels,
  changeLabels,
  changeTones,
  entityLabels,
  glyphOf,
  summary,
} from './history-format';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import '../transactions/transactions.css';
import './history.css';
import EmptyState from '@/ui/EmptyState';
import { ListRowText, rowClass } from '@/ui/ListRow';

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

function ChangeBadge({ change }: { change: AuditChange }) {
  return <Badge tone={changeTones[change]}>{changeLabels[change]}</Badge>;
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
      <td className="ui-num history-when">{time(event.at).replace(' UTC', '')}</td>
      <td>
        <ChangeBadge change={event.change} />
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
      <button type="button" className={rowClass({ open: current })} onClick={onOpen}>
        <Mark event={event} />
        <ListRowText
          title={event.title}
          detail={summary(event)}
          amount={changeLabels[event.change]}
          value={`${time(event.at).replace(' UTC', '')} · ${actorLabels[event.actor]}`}
        />
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
      limit: PAGE_SIZE,
    }),
    [entity, change, actor, from, to],
  );
  // Coming back shows the newest page last seen for this filter while a fresh one loads.
  const [history, setHistory] = useState<AuditHistory | null>(
    () => cachedReads.audit.last(query) ?? null,
  );
  // INFINITE: the changes read so far, twenty at a time; older ones are asked for with the
  // cursor the server gave when the end of the list is reached.
  const [events, setEvents] = useState<AuditEvent[]>(
    () => cachedReads.audit.last(query)?.events ?? [],
  );
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
      const page = await cachedReads.audit.load(query);
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
    if (!history?.next || loadingMore) return;
    const request = ++latest.current;
    setLoadingMore(true);
    setFailed(null);
    try {
      const page = await cachedReads.audit.load(query, history.next);
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
        <PageSkeleton label="Loading the change history" show={['rows']} rows={8} />
      ) : events.length === 0 && !filtered ? (
        <EmptyState id="history-empty" title="Nothing has changed yet">
          Every transaction you add, correct or delete, and every answer to a blockchain
          transaction, is listed here with the time it happened.
        </EmptyState>
      ) : (
        <section className="shell-card" aria-label="Change history">
          <div className="ui-toolbar">
            <div className="ui-chips" role="group" aria-label="Filter by change">
              <button
                type="button"
                className="ui-chip"
                aria-pressed={!change}
                onClick={() => update({ change: '' })}
              >
                All
              </button>
              {changes.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="ui-chip"
                  aria-pressed={change === key}
                  onClick={() => update({ change: key })}
                >
                  {changeLabels[key]}
                </button>
              ))}
            </div>
            <div className="ui-filters">
              <label className="ui-filter">
                <span>Type</span>
                <select
                  className="ui-input ui-input--sm"
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
              <label className="ui-filter">
                <span>Source</span>
                <select
                  className="ui-input ui-input--sm"
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
              <label className="ui-filter">
                <span>From</span>
                <input
                  className="ui-input ui-input--sm"
                  type="date"
                  value={from ?? ''}
                  max={to ?? undefined}
                  onChange={(event) => update({ from: event.target.value })}
                />
              </label>
              <label className="ui-filter">
                <span>To</span>
                <input
                  className="ui-input ui-input--sm"
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
            <ol className="ui-rows transactions-list" aria-label="Changes">
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
            <div className="ui-table-wrap">
              <table className="ui-table transactions-table history-table" aria-label="Changes">
                <colgroup>
                  <col className="history-col--when" />
                  <col className="history-col--change" />
                  <col className="history-col--operation" />
                  <col className="history-col--what" />
                  <col className="history-col--source" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="ui-num">
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
            <p className="ui-banner ui-banner--neg" role="alert">
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
          {history.next && !failed && (
            <LoadMore
              shown={events.length}
              onMore={() => void more()}
              busy={loadingMore}
              label="changes"
            />
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

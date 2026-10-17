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
import { useSearchParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button, ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip, ChipGroup } from '@/ui/Chip';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import FilterSheet from '@/ui/FilterSheet';
import { Input, Select } from '@/ui/inputs';
import { ListRowText, rowClass } from '@/ui/ListRow';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import AssetIcon from '../shell/AssetIcon';
import LoadMore, { PAGE_SIZE } from '../shell/InfiniteScroll';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import { Glyph } from '../transactions/TypeIcon';
import HistoryDrawer from './HistoryDrawer';
import {
  actorLabels,
  changeLabels,
  changeTones,
  entityLabels,
  glyphOf,
  moscowClock,
  moscowDayHeading,
  summary,
} from './history-format';
import '../shell/shell-page.css';
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
    <span className="history-mark">
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
      className={current ? 'history-row--open' : undefined}
      data-event={event.id}
      aria-current={current || undefined}
      onClick={onOpen}
    >
      <td className="ui-num history-when">{moscowClock(event.at)}</td>
      <td>
        <ChangeBadge change={event.change} />
      </td>
      <td className="history-wrap">
        <span className="history-type">
          <Mark event={event} />
          <span>
            <button
              type="button"
              className="history-open"
              onClick={(click) => {
                click.stopPropagation();
                onOpen();
              }}
            >
              {event.title}
            </button>
            <span className="history-sub">{event.account ?? 'No account'}</span>
          </span>
        </span>
      </td>
      <td className="history-wrap">{summary(event)}</td>
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
          value={`${moscowClock(event.at)} MSK · ${actorLabels[event.actor]}`}
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

  // One group per Moscow day of the change (the app's day), under a heading as in Transactions.
  const days: { heading: string; events: AuditEvent[] }[] = [];
  for (const event of events) {
    const heading = moscowDayHeading(event.at, history?.at ?? event.at);
    const last = days.at(-1);
    if (last?.heading === heading) last.events.push(event);
    else days.push({ heading, events: [event] });
  }

  return (
    <div className="shell-page">
      <PageHeader
        title="History"
        currencySwitch={false}
        actions={
          <ButtonLink variant="ghost" to="/preferences">
            Back to Settings
          </ButtonLink>
        }
      />
      {failed === 'load' && history === null ? (
        <ErrorState onRetry={() => void load()}>
          Could not load the change history. Your data is safe; try again.
        </ErrorState>
      ) : history === null ? (
        <PageSkeleton label="Loading the change history" show={['rows']} rows={8} />
      ) : events.length === 0 && !filtered ? (
        <EmptyState id="history-empty" title="Nothing has changed yet">
          Every transaction you add, correct or delete, and every answer to a blockchain
          transaction, is listed here with the time it happened.
        </EmptyState>
      ) : (
        <Card labelledBy="history-list-title">
          <h2 id="history-list-title" className="ui-sr">
            Change history
          </h2>
          <div className="ui-toolbar">
            <ChipGroup label="Filter by change">
              <Chip pressed={!change} onClick={() => update({ change: '' })}>
                All
              </Chip>
              {changes.map((key) => (
                <Chip key={key} pressed={change === key} onClick={() => update({ change: key })}>
                  {changeLabels[key]}
                </Chip>
              ))}
            </ChipGroup>
            <FilterSheet
              active={[entity, actor, from, to].filter(Boolean).length}
              onReset={() => update({ entity: '', actor: '', from: '', to: '' })}
            >
              <label className="ui-filter">
                <span>Type</span>
                <Select
                  size="sm"
                  value={entity ?? ''}
                  onChange={(event) => update({ entity: event.target.value })}
                >
                  <option value="">All types</option>
                  {entities.map((key) => (
                    <option key={key} value={key}>
                      {entityLabels[key]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="ui-filter">
                <span>Source</span>
                <Select
                  size="sm"
                  value={actor ?? ''}
                  onChange={(event) => update({ actor: event.target.value })}
                >
                  <option value="">Any source</option>
                  {actors.map((key) => (
                    <option key={key} value={key}>
                      {actorLabels[key]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="ui-filter">
                <span>From</span>
                <Input
                  size="sm"
                  type="date"
                  value={from ?? ''}
                  max={to ?? undefined}
                  onChange={(event) => update({ from: event.target.value })}
                />
              </label>
              <label className="ui-filter">
                <span>To</span>
                <Input
                  size="sm"
                  type="date"
                  value={to ?? ''}
                  min={from ?? undefined}
                  onChange={(event) => update({ to: event.target.value })}
                />
              </label>
            </FilterSheet>
          </div>
          {events.length === 0 ? (
            <EmptyState
              id="history-none"
              title="No changes match"
              compact
              actions={
                <Button onClick={() => replaceParams(new URLSearchParams())}>Clear filters</Button>
              }
            />
          ) : narrow ? (
            <ol className="history-list" aria-label="Changes">
              {days.map((group) => (
                <li key={group.heading} className="history-list__day">
                  <h2 className="history-list__heading">{group.heading}</h2>
                  <ul className="ui-rows">
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
              <table className="ui-table history-table" aria-label="Changes">
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
                      Time, MSK
                    </th>
                    <th scope="col">Change</th>
                    <th scope="col">Transaction</th>
                    <th scope="col">What changed</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                {days.map((group) => (
                  <tbody key={group.heading}>
                    <tr className="history-day">
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
            <Banner
              tone="warn"
              role="alert"
              action={
                <Button size="sm" onClick={() => void (failed === 'more' ? more() : load())}>
                  Try again
                </Button>
              }
            >
              {failed === 'more'
                ? 'Could not load older changes.'
                : 'Could not load the changes for these filters.'}
            </Banner>
          )}
          {history.next && !failed && (
            <LoadMore
              shown={events.length}
              onMore={() => void more()}
              busy={loadingMore}
              label="changes"
            />
          )}
          <p className="ui-sub history-note">
            {events.length} {events.length === 1 ? 'change' : 'changes'} shown, newest first. Every
            change is kept as a new version, so nothing is overwritten; deleting a transaction adds
            a version that removes it from your calculations. Blockchain transactions are never
            deleted, only classified or hidden. Times are in UTC.
          </p>
        </Card>
      )}
      {opened && <HistoryDrawer event={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}

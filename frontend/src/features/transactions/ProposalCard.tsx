import type { ReactNode } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';

/**
 * An offer above the list (joined transfers, duplicates): what was found, one action per pair
 * and the rule it was found by. Nothing changes until the owner takes an offer.
 */
export function ProposalCard({
  id,
  title,
  lead,
  rule,
  more,
  children,
}: {
  /** The heading's id; the card is a region named by it. */
  id: string;
  title: string;
  lead: ReactNode;
  /** When something is offered, under the list. */
  rule: ReactNode;
  /** The next page of offers. */
  more?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card labelledBy={id} className="transactions-proposals">
      <CardHeader id={id} title={title} />
      <p className="transactions-proposals__lead">{lead}</p>
      <ul className="transactions-proposals__list">{children}</ul>
      {more}
      <Banner tone="info">{rule}</Banner>
    </Card>
  );
}

/** One offer: what it is, the lines that explain it, why it failed if it did, and its action. */
export function ProposalItem({
  summary,
  details,
  problem,
  action,
  busyLabel,
  busy,
  locked,
  onAct,
}: {
  summary: ReactNode;
  /** The lines under the summary, each a `ui-sub` span. */
  details: ReactNode;
  problem?: string | null;
  action: string;
  busyLabel: string;
  /** This offer is being taken. */
  busy: boolean;
  /** Another offer is being taken. */
  locked: boolean;
  onAct: () => void;
}) {
  return (
    <li className="transactions-proposal">
      <div className="transactions-proposal__text">
        {summary}
        {details}
        {problem && <Banner tone="neg">{problem}</Banner>}
      </div>
      <Button size="sm" busy={busy} disabled={locked} onClick={onAct}>
        {busy ? busyLabel : action}
      </Button>
    </li>
  );
}

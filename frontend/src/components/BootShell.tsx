import { accountingCurrencies } from '@api/portfolio-valuation.api';
import DashboardLoading from '@features/dashboard/DashboardLoading';
import { useAskedCurrency, withCurrency } from '@features/portfolio/currency';
import { BrandMark, Icon } from '@features/shell/icons';
import { retiredPaths, shellSections, tabSections } from '@features/shell/navigation';
import { Bone, PageSkeleton } from '@features/shell/Skeleton';
import { type ComponentProps, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SegmentedPlaceholder } from '@/ui/SegmentedControl';
import '@features/shell/shell-page.css';
import '@features/shell/tokens.css';
import './Layout.css';

// The rows each list page draws while its own data is on its way, so the card keeps its height.
const rowsOf: Record<string, number> = { transactions: 10, history: 8 };

// The page that replaces the frame must not fade in from an empty body. While this mark is on the
// root, the entrance fade of page bodies has no length (see shell-page.css); it comes off a moment
// after the frame leaves, so pages opened later fade in as before.
const HANDOVER_MS = 400;
let handoverTimer: number | undefined;

function markHandover(on: boolean) {
  window.clearTimeout(handoverTimer);
  if (on) document.documentElement.dataset.fromBoot = '';
  else
    handoverTimer = window.setTimeout(
      () => delete document.documentElement.dataset.fromBoot,
      HANDOVER_MS,
    );
}

type Blocks = ComponentProps<typeof PageSkeleton>['show'];

// What each section is made of, so the grey blocks stand where its content will.
const blocksOf: Record<string, Blocks> = {
  portfolio: ['stats', 'rows'],
  transactions: ['rows'],
  history: ['rows'],
  wallets: ['cards'],
  deposits: ['cards'],
  brokers: ['cards'],
  'real-estate': ['cards'],
  goals: ['cards'],
  preferences: ['cards'],
};

// An asset, a wallet or a deposit has its own shape, not the list's.
const nestedBlocksOf: Record<string, Blocks> = {
  portfolio: ['stats', 'chart', 'rows'],
  wallets: ['stats', 'rows'],
  deposits: ['cards'],
};

/** Where the owner ends up: the bare address and the retired bookmarks are sent on by the routes. */
function landingPath(address: string): string {
  // The router takes "/dashboard/" for "/dashboard".
  const pathname = address.length > 1 ? address.replace(/\/+$/, '') : address;
  const retired = retiredPaths.find(
    ([from]) => pathname === from || pathname.startsWith(`${from}/`),
  );
  if (retired) return retired[1];
  return pathname === '/' ? '/dashboard' : pathname;
}

/**
 * The page part of the frame: an empty head and grey blocks in the layout of the section the
 * path names. The frame draws it while the sign-in check is on its way, and a page that is still
 * being fetched (it comes as a separate file) draws it inside the real frame.
 */
export function BootPage() {
  const { pathname } = useLocation();
  const here = landingPath(pathname);
  const [section = '', ...rest] = here.split('/').filter(Boolean);
  const show =
    (rest.length > 0 ? nestedBlocksOf[section] : undefined) ??
    blocksOf[section] ??
    blocksOf.portfolio;
  return (
    <div className="shell-page shell-page--boot">
      <header className="shell-page__head">
        <div className="shell-page__bar">
          <BrandMark className="shell-page__mark" />
          <h1>
            <Bone width={180} height={29} />
          </h1>
          {/* The bell's room, so the title does not step aside when the page arrives. */}
          <div className="shell-page__bell shell-page__bell--hold" />
        </div>
        <div className="shell-page__switches">
          <SegmentedPlaceholder labels={accountingCurrencies} />
        </div>
      </header>
      {here === '/dashboard' ? (
        // The Dashboard draws its own stand-in (a net-worth hero, then the chart).
        <DashboardLoading />
      ) : (
        <PageSkeleton label="Loading" show={show} rows={rowsOf[section]} />
      )}
    </div>
  );
}

/**
 * The frame of the application (navigation, an empty page head, grey blocks) drawn while the
 * sign-in check is on its way, so the first thing on screen is the place the owner is going to,
 * not a sentence. It asks for nothing: no data is read until the owner is known.
 */
export default function BootShell() {
  const { pathname } = useLocation();
  // The selected currency stays on the links, as in the navigation that replaces this one.
  const [asked] = useAskedCurrency();
  useEffect(() => {
    markHandover(true);
    return () => markHandover(false);
  }, []);

  const here = landingPath(pathname);

  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Main navigation">
        <div className="shell-nav__header">
          <div className="shell-brand">
            <BrandMark />
            Capital
          </div>
        </div>
        <div className="shell-nav__menu">
          <ul className="shell-nav__sections" data-nav-group="sections">
            {shellSections
              .filter((entry) => !entry.held || here.startsWith(entry.path))
              .map((entry) => (
                <li
                  key={entry.path}
                  className={tabSections.includes(entry.path) ? undefined : 'shell-nav__in-more'}
                >
                  <Link
                    to={withCurrency(entry.path, asked)}
                    aria-current={
                      here === entry.path || here.startsWith(`${entry.path}/`) ? 'page' : undefined
                    }
                  >
                    <Icon name={entry.icon} />
                    <span className="shell-nav__label">{entry.label}</span>
                  </Link>
                </li>
              ))}
            <li className="shell-nav__more">
              <button
                type="button"
                disabled
                aria-current={
                  shellSections.some(
                    (entry) =>
                      !tabSections.includes(entry.path) &&
                      (here === entry.path || here.startsWith(`${entry.path}/`)),
                  )
                    ? 'page'
                    : undefined
                }
              >
                <Icon name="more" />
                <span className="shell-nav__label">More</span>
              </button>
            </li>
          </ul>
        </div>
        <div className="shell-owner">
          <span className="shell-owner__avatar" aria-hidden="true" />
          <span className="shell-owner__who">
            {/* No claim about who this is before the sign-in check has answered. */}
            <span className="shell-owner__name">
              <Bone width={56} height={14} />
            </span>
            <small>
              <Bone width={40} height={11} />
            </small>
          </span>
          <button type="button" className="shell-owner__logout" disabled aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </nav>
      <main id="main-content" className="shell-main">
        <BootPage />
      </main>
    </div>
  );
}

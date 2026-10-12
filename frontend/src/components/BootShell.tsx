import { useAskedCurrency, withCurrency } from '@features/portfolio/currency';
import { BrandMark, Icon } from '@features/shell/icons';
import { retiredPaths, shellSections } from '@features/shell/navigation';
import { Bone, PageSkeleton } from '@features/shell/Skeleton';
import { type ComponentProps, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '@features/shell/shell-page.css';
import '@features/shell/tokens.css';
import './Layout.css';

type Blocks = ComponentProps<typeof PageSkeleton>['show'];

// What each section is made of, so the grey blocks stand where its content will.
const blocksOf: Record<string, Blocks> = {
  dashboard: ['stats', 'chart'],
  portfolio: ['stats', 'rows'],
  transactions: ['rows'],
  history: ['rows'],
  wallets: ['cards'],
  deposits: ['cards'],
  preferences: ['cards'],
};

// An asset, a wallet or a deposit has its own shape, not the list's.
const nestedBlocksOf: Record<string, Blocks> = {
  portfolio: ['stats', 'chart', 'rows'],
  wallets: ['stats', 'rows'],
  deposits: ['cards'],
};

/** Where the owner ends up: the bare address and the retired bookmarks are sent on by the routes. */
function landingPath(pathname: string): string {
  const retired = retiredPaths.find(
    ([from]) => pathname === from || pathname.startsWith(`${from}/`),
  );
  if (retired) return retired[1];
  return pathname === '/' ? '/dashboard' : pathname;
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
  const menuRef = useRef<HTMLDivElement>(null);
  const here = landingPath(pathname);
  const [section = '', ...rest] = here.split('/').filter(Boolean);

  // Phones show the sections as a strip: keep the current one in view, as Layout does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path decides which link is current.
  useEffect(() => {
    const strip = menuRef.current;
    const current = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!strip || !current || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);
  const show =
    (rest.length > 0 ? nestedBlocksOf[section] : undefined) ??
    blocksOf[section] ??
    blocksOf.portfolio;
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Main navigation">
        <div className="shell-nav__header">
          <div className="shell-brand">
            <BrandMark />
            Capital
          </div>
        </div>
        <div ref={menuRef} className="shell-nav__menu">
          <ul className="shell-nav__sections" data-nav-group="sections">
            {shellSections.map((entry) => (
              <li key={entry.path}>
                <Link
                  to={withCurrency(entry.path, asked)}
                  aria-current={
                    here === entry.path || here.startsWith(`${entry.path}/`) ? 'page' : undefined
                  }
                >
                  <Icon name={entry.icon} />
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="shell-owner">
          <div className="shell-owner__bell" />
          <span className="shell-owner__avatar" aria-hidden="true" />
          <span className="shell-owner__who">
            <span className="shell-owner__name">Owner</span>
            <small>2FA on</small>
          </span>
          <button type="button" className="shell-owner__logout" disabled aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </nav>
      <main id="main-content" className="shell-main">
        <div className="shell-page shell-page--boot">
          <header className="shell-page__head">
            <Bone width={180} height={32} />
          </header>
          <PageSkeleton
            label="Loading"
            show={show}
            rows={section === 'transactions' ? 10 : undefined}
          />
        </div>
      </main>
    </div>
  );
}

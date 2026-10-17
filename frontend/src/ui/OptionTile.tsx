import { createContext, type MouseEventHandler, type ReactNode, useContext } from 'react';
import './option.css';

type Layout = 'option' | 'tile';
const LayoutContext = createContext<Layout>('option');

/**
 * Choices drawn as a grid of buttons with aria-pressed: `option` is the compact two-column
 * grid of the classify drawer (prototype .opt-grid), `tile` the larger tiles with a line of
 * description (prototype .net-grid: networks, what to add to the portfolio).
 */
export function OptionGrid({
  label,
  labelledBy,
  layout = 'option',
  children,
}: {
  label?: string;
  labelledBy?: string;
  layout?: Layout;
  children: ReactNode;
}) {
  return (
    <LayoutContext.Provider value={layout}>
      <div
        className={layout === 'tile' ? 'ui-tile-grid' : 'ui-opt-grid'}
        role="group"
        aria-label={label}
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </LayoutContext.Provider>
  );
}

/**
 * One choice. Its accessible name starts with the title (the icon is hidden), then the
 * description and the "Suggested" tag.
 */
export function OptionTile({
  pressed,
  onClick,
  icon,
  title,
  description,
  suggested = false,
  wide = false,
  disabled,
}: {
  pressed: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  suggested?: boolean;
  /** Takes both columns. */
  wide?: boolean;
  disabled?: boolean;
}) {
  const layout = useContext(LayoutContext);
  const base = layout === 'tile' ? 'ui-tile' : 'ui-opt';
  return (
    <button
      type="button"
      className={wide ? `${base} ${base}--wide` : base}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && (
        <span className={`${base}__icon`} aria-hidden="true">
          {icon}
        </span>
      )}
      {/* The spaces sit between the parts, so the name reads "Solana SOL and SPL tokens". */}
      <span className={`${base}__text`}>
        <b className={`${base}__title`}>{title}</b>
        {description && (
          <>
            {' '}
            <small className={`${base}__desc`}>{description}</small>
          </>
        )}
      </span>
      {suggested && (
        <>
          {' '}
          <span className="ui-opt__sugg">Suggested</span>
        </>
      )}
    </button>
  );
}

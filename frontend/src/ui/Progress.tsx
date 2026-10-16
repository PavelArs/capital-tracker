import './progress.css';

/**
 * A progress bar. With `value` (0 to 100) it is determinate and says how far (a goal); without,
 * it says only that something runs (a wallet syncing). `thin` is the 3 px line beside a badge,
 * `bar` the 8 px bar of a goal.
 */
export function Progress({
  value,
  label,
  tone = 'accent',
  size = 'bar',
}: {
  value?: number;
  /** Names the bar: "Saved towards Flat", "Syncing transactions". */
  label: string;
  /** pos once the target is reached. */
  tone?: 'accent' | 'pos';
  size?: 'thin' | 'bar';
}) {
  const width =
    value !== undefined && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
  const known = width !== undefined;
  const classes = [
    'ui-progress',
    `ui-progress--${size}`,
    tone === 'pos' ? 'ui-progress--pos' : '',
    known ? '' : 'ui-progress--indeterminate',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={width}
    >
      <i style={width === undefined ? undefined : { width: `${width}%` }} />
    </div>
  );
}

import './steps.css';

/** Where a multi-step dialog is: one bar per step, then "Step N of M" in words. */
export function Steps({ current, total }: { current: number; total: number }) {
  return (
    <div className="ui-steps">
      <span className="ui-steps__bars" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => index + 1).map((step) => (
          <i
            key={step}
            className={step <= current ? 'ui-steps__bar ui-steps__bar--on' : 'ui-steps__bar'}
          />
        ))}
      </span>
      <span className="ui-steps__label">
        Step {current} of {total}
      </span>
    </div>
  );
}

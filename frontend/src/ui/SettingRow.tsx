import type { ReactNode } from 'react';
import './setting-row.css';

/**
 * One setting (prototype Settings row): the title and a muted description at the left, the
 * control at the right; they wrap on a phone. `status` is a live line under the description
 * for what the control just did ("Saved.", "Preparing…"); it is there, empty, before anything
 * happens, so screen readers hear the change.
 */
export function SettingRow({
  title,
  titleId,
  description,
  control,
  status,
}: {
  title: ReactNode;
  /** Lets the control be labelled by the title (aria-labelledby). */
  titleId?: string;
  description?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className="ui-setting">
      <div className="ui-setting__text">
        <span id={titleId} className="ui-setting__title">
          {title}
        </span>
        {description && <p className="ui-setting__desc">{description}</p>}
        {status !== undefined && (
          <p className="ui-setting__status" role="status">
            {status}
          </p>
        )}
      </div>
      {control && <div className="ui-setting__control">{control}</div>}
    </div>
  );
}

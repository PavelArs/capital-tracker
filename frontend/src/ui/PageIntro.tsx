import type { ReactNode } from 'react';
import './page-intro.css';

/** The line under a page's title that says what the page holds, with the page's main action beside it. */
export default function PageIntro({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ui-intro">
      <p className="ui-intro__text">{children}</p>
      {action}
    </div>
  );
}

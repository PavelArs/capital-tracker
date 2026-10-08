import { BrandMark, Icon, type IconName } from '@features/shell/icons';
import type { FormEvent, ReactNode } from 'react';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/onest';
import '@features/shell/tokens.css';
import './password-reset.css';

type Tone = 'accent' | 'pos' | 'warn';

interface AuthFrameProps {
  icon: IconName;
  tone?: Tone;
  title: string;
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}

/** The prototype's sign-in frame: brand above one box with an icon and a heading. */
export default function AuthFrame({
  icon,
  tone = 'accent',
  title,
  children,
  onSubmit,
}: AuthFrameProps) {
  const body = (
    <>
      <div className={tone === 'accent' ? 'auth-ico' : `auth-ico auth-ico--${tone}`}>
        <Icon name={icon} />
      </div>
      <h1 id="auth-heading">{title}</h1>
      {children}
    </>
  );
  return (
    <main className="auth">
      <div className="auth-wrap">
        <div className="auth-logo">
          <BrandMark />
          Capital
        </div>
        {onSubmit ? (
          <form className="auth-box" aria-labelledby="auth-heading" noValidate onSubmit={onSubmit}>
            {body}
          </form>
        ) : (
          <section className="auth-box" aria-labelledby="auth-heading">
            {body}
          </section>
        )}
      </div>
    </main>
  );
}

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span className="auth-err" id={id}>
      <Icon name="alert" />
      {message}
    </span>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'neg' | 'pos'; children: ReactNode }) {
  const icon: IconName = tone === 'info' ? 'info' : tone === 'neg' ? 'alert' : 'check';
  return (
    <div className={`auth-note auth-note--${tone}`} role={tone === 'neg' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

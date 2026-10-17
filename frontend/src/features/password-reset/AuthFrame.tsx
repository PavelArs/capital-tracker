import { BrandMark, Icon, type IconName } from '@features/shell/icons';
import { appTitle } from '@features/shell/navigation';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/onest';
import '@features/shell/tokens.css';
import './password-reset.css';

type Tone = 'accent' | 'pos' | 'warn';

/** Ref callback for the field a step opens with, so the cursor is already in it. */
export const focusOnMount = (input: HTMLInputElement | null) => {
  input?.focus();
};

/**
 * Puts the cursor back on a control once the form shows its answer: the first field with a
 * problem, or the one to try again. Controls are disabled while a request runs, so the focus
 * waits for the render that enables them again (prototype: focus the first invalid field).
 */
export function useFocusAfterAnswer() {
  const [target, setTarget] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (target) document.getElementById(target.id)?.focus();
  }, [target]);
  return useCallback((id: string) => setTarget({ id }), []);
}

interface AuthFrameProps {
  icon?: IconName;
  tone?: Tone;
  title: string;
  children: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** A quiet line under the box, such as a way back to the first step. */
  footer?: ReactNode;
}

/** The prototype's sign-in frame: brand above one box with an icon and a heading. */
export default function AuthFrame({
  icon,
  tone = 'accent',
  title,
  children,
  onSubmit,
  footer,
}: AuthFrameProps) {
  // The tab names the step, as the signed-in pages name theirs.
  useEffect(() => {
    document.title = `${title} · ${appTitle}`;
  }, [title]);
  // A step that opens without a field to type in ("Check your email", an expired link) puts the
  // keyboard and the screen reader on its heading; a step with one has already focused it.
  const heading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step is what moves the keyboard.
  useEffect(() => {
    const active = document.activeElement;
    const box = heading.current?.closest('.auth-box');
    if (active && active !== document.body && box?.contains(active)) return;
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  const body = (
    <>
      {icon && (
        <div className={tone === 'accent' ? 'auth-ico' : `auth-ico auth-ico--${tone}`}>
          <Icon name={icon} />
        </div>
      )}
      <h1 id="auth-heading" ref={heading} tabIndex={-1}>
        {title}
      </h1>
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
        {footer && <p className="auth-foot">{footer}</p>}
      </div>
    </main>
  );
}

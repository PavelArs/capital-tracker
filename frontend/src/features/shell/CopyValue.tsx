import { useEffect, useState } from 'react';
import { Icon } from './icons';
import './copy-value.css';

/** The prototype's short form of an address or hash: "0x3B9d…8F32", "bc1q9h…3x2r". */
export function shortValue(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, value.startsWith('0x') ? 5 : 6)}…${value.slice(-4)}`;
}

/**
 * An address, hash or key the way the prototype shows one: its short form in the mono face and a
 * quiet copy button after it. The full value is in the tooltip and is what gets copied; the button
 * turns into a check for two seconds.
 */
export default function CopyValue({
  value,
  text,
  label = 'Copy full value',
}: {
  value: string;
  /** What to show instead of the short form, such as a label. */
  text?: string;
  /** What the button is called for a screen reader. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <span className="copy-value" title={value}>
      <span className="copy-value__text">{text ?? shortValue(value)}</span>
      <button
        type="button"
        className="copy-value__button"
        aria-label={copied ? 'Copied' : label}
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} className="shell-icon shell-icon--sm" />
      </button>
    </span>
  );
}

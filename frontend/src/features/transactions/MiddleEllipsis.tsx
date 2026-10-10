/**
 * A long address or hash on one line: when it does not fit, the middle gives way ("0x3B9d…8F32")
 * and the full value stays in the text and in the tooltip. Plain CSS, so selecting and copying
 * still take the whole value.
 */
export default function MiddleEllipsis({ text, tail = 6 }: { text: string; tail?: number }) {
  if (text.length <= tail * 2) return <span className="transactions-mono">{text}</span>;
  return (
    <span className="transactions-mono transactions-mid" title={text}>
      <span className="transactions-mid__head">{text.slice(0, -tail)}</span>
      <span className="transactions-mid__tail">{text.slice(-tail)}</span>
    </span>
  );
}

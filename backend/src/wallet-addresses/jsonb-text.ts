// PostgreSQL jsonb cannot hold the character U+0000 or an unpaired UTF-16 surrogate in a string,
// in a value or in a key. A provider's raw object is stored as it came, so one such character
// in a token name or a memo would fail the whole insert and every later pass with it, and the
// wallet's history would never advance. This is the one place that turns a provider object into
// jsonb text: every such character is kept as its visible escape ("\u0000", "\ud800"), so the
// object stays complete evidence and nothing else about it changes.

const escapeUnit = (unit: number) => `\\u${unit.toString(16).padStart(4, '0')}`;

/** The text with every U+0000 and unpaired surrogate written as an escape; the same text if none. */
export function jsonbSafeText(text: string): string {
  let safe: string | null = null;
  for (let at = 0; at < text.length; at++) {
    const unit = text.charCodeAt(at);
    let bad = unit === 0;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(at + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (safe !== null) safe += text[at] + text[at + 1];
        at++;
        continue;
      }
      bad = true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) bad = true;
    if (bad) {
      safe ??= text.slice(0, at);
      safe += escapeUnit(unit);
    } else if (safe !== null) safe += text[at];
  }
  return safe ?? text;
}

function safeValue(value: unknown): unknown {
  if (typeof value === 'string') return jsonbSafeText(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  // A key is text too; two keys that become alike keep both, the later one numbered.
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    let name = jsonbSafeText(key);
    for (let copy = 2; Object.hasOwn(clean, name); copy++) name = `${jsonbSafeText(key)}#${copy}`;
    clean[name] = item;
  }
  return clean;
}

/** JSON text of a provider object that PostgreSQL jsonb accepts, equal to JSON.stringify otherwise. */
export function jsonbText(value: unknown): string {
  return JSON.stringify(value, (_key, item) => safeValue(item));
}

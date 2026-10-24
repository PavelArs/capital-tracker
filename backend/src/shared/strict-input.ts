/**
 * A request body or nested value read strictly: a plain object (prototype `Object.prototype`
 * or `null`), not an array, whose own keys, symbols and non-enumerable ones included, are all
 * strings from `keys`, with every `required` key defined. Returns undefined otherwise, so each
 * caller throws its own error.
 */
export function strictRecord(
  raw: unknown,
  keys: readonly string[],
  required: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !keys.includes(key)))
    return undefined;
  const record = raw as Record<string, unknown>;
  if (required.some((key) => record[key] === undefined)) return undefined;
  return record;
}

/** A JSON number that is a safe integer within [minimum, maximum], with -0 read as 0. */
export function strictInteger(raw: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < minimum || raw > maximum)
    return undefined;
  return raw === 0 ? 0 : raw;
}

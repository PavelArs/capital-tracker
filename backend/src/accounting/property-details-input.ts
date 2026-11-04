import { BadRequestException } from '@nestjs/common';
import { parseAmount } from '../deposits/deposit-input';
import { strictRecord } from '../shared/strict-input';

/** The longest note kept with a property, in characters. */
export const MAX_PROPERTY_NOTE = 500;

export interface PropertyDetailsInput {
  /** The rent a month in the currency the property is valued in; null when it brings none. */
  monthlyRent: string | null;
  /** The owner's free text (a mortgage, a tenant, a contract end); null when there is none. */
  note: string | null;
}

const bad = (): never => {
  throw new BadRequestException('Invalid property details');
};

function note(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return bad();
  // Line breaks are fine in a note; any other control character is not.
  if (
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code < 32 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);
    })
  )
    return bad();
  const text = value.trim();
  if (Array.from(text).length > MAX_PROPERTY_NOTE || Buffer.from(text).toString('utf8') !== text)
    return bad();
  return text === '' ? null : text;
}

/**
 * PROP-DETAILS: what the owner records about a property besides its estimate. Both fields are
 * always given, so a command states the whole record and repeating it changes nothing.
 */
export function parsePropertyDetails(input: unknown): PropertyDetailsInput {
  const keys = ['monthlyRent', 'note'];
  const record = strictRecord(input, keys, keys) ?? bad();
  return {
    monthlyRent: record.monthlyRent === null ? null : parseAmount(record.monthlyRent),
    note: note(record.note),
  };
}

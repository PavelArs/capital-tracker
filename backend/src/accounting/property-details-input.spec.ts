import { BadRequestException } from '@nestjs/common';
import { MAX_PROPERTY_NOTE, parsePropertyDetails } from './property-details-input';

describe('PROP-DETAILS strict property details', () => {
  it('keeps a rent as the cent amount entered and a note as typed', () => {
    expect(parsePropertyDetails({ monthlyRent: '450', note: ' Mortgage ends 2031 ' })).toEqual({
      monthlyRent: '450.00',
      note: 'Mortgage ends 2031',
    });
    expect(parsePropertyDetails({ monthlyRent: '1200.5', note: null })).toEqual({
      monthlyRent: '1200.50',
      note: null,
    });
  });

  it('PROP-DETAILS-EMPTY takes no rent and no note as null, and a blank note as no note', () => {
    expect(parsePropertyDetails({ monthlyRent: null, note: null })).toEqual({
      monthlyRent: null,
      note: null,
    });
    expect(parsePropertyDetails({ monthlyRent: null, note: '   ' })).toEqual({
      monthlyRent: null,
      note: null,
    });
  });

  it('accepts a note up to the limit and refuses one a character longer', () => {
    const note = 'x'.repeat(MAX_PROPERTY_NOTE);
    expect(parsePropertyDetails({ monthlyRent: null, note }).note).toBe(note);
    expect(() => parsePropertyDetails({ monthlyRent: null, note: `${note}x` })).toThrow(
      BadRequestException,
    );
  });

  it('allows line breaks in a note but no other control characters', () => {
    expect(parsePropertyDetails({ monthlyRent: null, note: 'one\ntwo' }).note).toBe('one\ntwo');
    expect(() => parsePropertyDetails({ monthlyRent: null, note: 'a\u0000b' })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    { monthlyRent: 450 },
    { monthlyRent: '0' },
    { monthlyRent: '0.00' },
    { monthlyRent: '-1' },
    { monthlyRent: '1e3' },
    { monthlyRent: '1,5' },
    { monthlyRent: '1.234' },
    { monthlyRent: ' 5' },
    { monthlyRent: '1'.repeat(13) },
    { monthlyRent: undefined },
    { note: 5 },
    { note: undefined },
    { ownerId: '00000000-0000-4000-8000-000000000000' },
    { instrumentId: '00000000-0000-4000-8000-000000000000' },
  ])('rejects invalid or unknown input %p', (changes) => {
    expect(() => parsePropertyDetails({ monthlyRent: '450', note: null, ...changes })).toThrow(
      BadRequestException,
    );
  });

  it.each([null, undefined, 'text', 5, [], [{ monthlyRent: null, note: null }]])(
    'rejects a body that is not an object: %p',
    (body) => {
      expect(() => parsePropertyDetails(body)).toThrow(BadRequestException);
    },
  );
});

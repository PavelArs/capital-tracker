import { OwnerInputError, parseOwnerCommand, parsePasswordJson } from './owner-input';

describe('OWN-002-B CLI input before credentials/database work', () => {
  it('accepts explicit commands without any password argument', () => {
    expect(
      parseOwnerCommand(['bootstrap', '--email', ' OWNER@example.invalid ', '--password-stdin']),
    ).toEqual({
      action: 'bootstrap',
      email: 'owner@example.invalid',
      userId: undefined,
      passwordStdin: true,
    });
    expect(
      parseOwnerCommand(['recover', '--user-id', '11111111-1111-4111-8111-111111111111'])
        .passwordStdin,
    ).toBe(false);
  });

  it.each([
    [],
    ['register'],
    ['bootstrap'],
    ['recover'],
    ['bootstrap', '--email', 'bad'],
    ['bootstrap', '--email', 'owner@example.invalid', '--email', 'other@example.invalid'],
    ['bootstrap', '--email', 'owner@example.invalid', '--password', 'secret'],
    ['bootstrap', '--email', 'owner@example.invalid', '--password-stdin', '--password-stdin'],
    ['recover', '--user-id', 'not-uuid'],
    ['recover', '--existing-user-id', '11111111-1111-4111-8111-111111111111'],
  ])('rejects invalid options %j', (...args) => {
    expect(() => parseOwnerCommand(args)).toThrow(OwnerInputError);
  });

  it('preserves exact password bytes in JSON', () => {
    const password = '  Unicode пароль 🔐 1234  ';
    expect(
      parsePasswordJson(Buffer.from(JSON.stringify({ password, confirmation: password }))),
    ).toBe(password);
  });

  it.each([
    '',
    'null',
    '[]',
    '{}',
    '{broken',
    '{"password":"short","confirmation":"short"}',
    JSON.stringify({ password: 'Valid-password-123', confirmation: 'different-password-123' }),
    JSON.stringify({
      password: 'Valid-password-123',
      confirmation: 'Valid-password-123',
      extra: true,
    }),
    'x'.repeat(4097),
  ])('rejects invalid bounded JSON', (input) => {
    expect(() => parsePasswordJson(Buffer.from(input))).toThrow(OwnerInputError);
  });

  it('rejects malformed UTF-8 rather than silently replacing password bytes', () => {
    expect(() => parsePasswordJson(Buffer.from([0xff]))).toThrow(OwnerInputError);
  });
});

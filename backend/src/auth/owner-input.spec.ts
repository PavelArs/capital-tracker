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

describe('OWN-002-B the error each CLI input gives, checked in order', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const outcome = (args: string[]) => {
    try {
      return parseOwnerCommand(args);
    } catch (error) {
      return error instanceof OwnerInputError ? error.message : error;
    }
  };
  const usage =
    'Use owner-cli.js bootstrap --email EMAIL [--existing-user-id UUID] or recover --user-id UUID; optional --password-stdin';

  it.each([
    [[], usage],
    [['register', '--email', 'owner@example.invalid'], usage],
    [['bootstrap'], 'Invalid owner email input'],
    [['bootstrap', '--email', 'bad', '--user-id', userId], 'Invalid or duplicate CLI option'],
    [['bootstrap', '--password-stdin', '--password-stdin'], 'Invalid or duplicate CLI option'],
    [['bootstrap', '--email'], 'Missing CLI option value'],
    [['bootstrap', '--email', '--password-stdin'], 'Missing CLI option value'],
    [['bootstrap', '--email', 'bad', '--existing-user-id', 'x'], 'Invalid owner email input'],
    [['bootstrap', '--email', `${'a'.repeat(243)}@example.com`], 'Invalid owner email input'],
    [
      ['bootstrap', '--email', 'owner@example.invalid', '--existing-user-id', 'x'],
      'Invalid or missing owner user ID',
    ],
    [['recover'], 'Invalid or missing owner user ID'],
    [['recover', '--email', 'owner@example.invalid'], 'Invalid or duplicate CLI option'],
    [['recover', '--user-id', 'x'], 'Invalid or missing owner user ID'],
  ])('refuses %j with its own message', (args, message) => {
    expect(outcome(args)).toBe(message);
  });

  it('keeps an explicit existing user for bootstrap and the user for recovery', () => {
    expect(
      outcome(['bootstrap', '--existing-user-id', userId, '--email', 'Owner@Example.invalid']),
    ).toEqual({
      action: 'bootstrap',
      email: 'owner@example.invalid',
      userId,
      passwordStdin: false,
    });
    expect(outcome(['recover', '--password-stdin', '--user-id', userId])).toEqual({
      action: 'recover',
      email: undefined,
      userId,
      passwordStdin: true,
    });
  });
});

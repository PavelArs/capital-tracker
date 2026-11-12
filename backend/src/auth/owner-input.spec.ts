import { EventEmitter } from 'node:events';
import {
  hiddenQuestion,
  OwnerInputError,
  parseOwnerCommand,
  parsePasswordJson,
} from './owner-input';

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

// A raw-mode terminal as hiddenQuestion drives it; every call is recorded in order.
class FakeTerminal extends EventEmitter {
  readonly calls: string[] = [];
  constructor(readonly isRaw: boolean | undefined) {
    super();
  }
  setEncoding(encoding: string) {
    this.calls.push(`setEncoding:${encoding}`);
    return this;
  }
  setRawMode(mode: boolean) {
    this.calls.push(`setRawMode:${mode}`);
    return this;
  }
  resume() {
    this.calls.push('resume');
    return this;
  }
  pause() {
    this.calls.push('pause');
    return this;
  }
}

describe('OWN-002-B hidden password input from a terminal', () => {
  let terminal: FakeTerminal;
  let written: string[];
  let sigtermBefore: Function[];

  const start = (isRaw: boolean | undefined = undefined) => {
    terminal = new FakeTerminal(isRaw);
    jest
      .spyOn(process, 'stdin', 'get')
      .mockReturnValue(terminal as unknown as typeof process.stdin);
    sigtermBefore = process.listeners('SIGTERM');
    return hiddenQuestion('Synthetic prompt: ');
  };
  const settled = async (answer: Promise<string>) => {
    try {
      return { value: await answer };
    } catch (error) {
      return {
        error: error instanceof OwnerInputError ? `OwnerInputError: ${error.message}` : error,
      };
    }
  };
  const restored = () => {
    expect(terminal.listenerCount('data')).toBe(0);
    expect(terminal.listenerCount('end')).toBe(0);
    expect(process.listeners('SIGTERM')).toEqual(sigtermBefore);
    expect(written).toEqual(['Synthetic prompt: ', '\n']);
  };

  beforeEach(() => {
    written = [];
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('prompts on stderr, reads raw UTF-8 and restores the terminal after a line end', async () => {
    const answer = start();
    expect(written).toEqual(['Synthetic prompt: ']);
    expect(terminal.calls).toEqual(['setEncoding:utf8', 'setRawMode:true', 'resume']);
    terminal.emit('data', 'abc\r');
    expect(await settled(answer)).toEqual({ value: 'abc' });
    expect(terminal.calls).toEqual([
      'setEncoding:utf8',
      'setRawMode:true',
      'resume',
      'setRawMode:false',
      'pause',
    ]);
    restored();
  });

  it('returns the terminal to raw mode when it was raw before', async () => {
    const answer = start(true);
    terminal.emit('data', 'x\n');
    expect(await settled(answer)).toEqual({ value: 'x' });
    expect(terminal.calls.slice(-2)).toEqual(['setRawMode:true', 'pause']);
    restored();
  });

  it('joins chunks and ignores everything after the line end', async () => {
    const answer = start();
    terminal.emit('data', ' Unicode пароль');
    terminal.emit('data', ' 🔐\nignored\r');
    terminal.emit('data', 'later');
    expect(await settled(answer)).toEqual({ value: ' Unicode пароль 🔐' });
    restored();
  });

  it('erases one whole code point per DEL or backspace, also on an empty value', async () => {
    const answer = start();
    terminal.emit('data', '\u007f\bab🔐\u007f\bc');
    terminal.emit('data', '\u007fd\r');
    expect(await settled(answer)).toEqual({ value: 'ad' });
    restored();
  });

  it.each([
    ['Ctrl-C', 'abc\u0003\r'],
    ['Ctrl-D', 'abc\u0004'],
    ['Ctrl-C before a line end', '\u0003abc\n'],
  ])('cancels on %s', async (_name, chunk) => {
    const answer = start();
    terminal.emit('data', chunk);
    expect(await settled(answer)).toEqual({ error: 'OwnerInputError: Password input cancelled' });
    restored();
  });

  it('cancels when the input ends', async () => {
    const answer = start();
    terminal.emit('data', 'abc');
    terminal.emit('end');
    expect(await settled(answer)).toEqual({ error: 'OwnerInputError: Password input cancelled' });
    restored();
  });

  it('cancels on SIGTERM through its own listener', async () => {
    const answer = start();
    const added = process
      .listeners('SIGTERM')
      .filter((listener) => !sigtermBefore.includes(listener));
    expect(added).toHaveLength(1);
    terminal.emit('data', 'abc');
    (added[0] as () => void)();
    expect(await settled(answer)).toEqual({ error: 'OwnerInputError: Password input cancelled' });
    restored();
  });

  it.each([
    ['512 ASCII bytes', ['a'.repeat(512), '\r'], { value: 'a'.repeat(512) }],
    ['512 bytes of four-byte code points', [`${'🔐'.repeat(128)}\r`], { value: '🔐'.repeat(128) }],
    ['a line end before the excess', [`abc\r${'a'.repeat(600)}`], { value: 'abc' }],
    [
      'erasing back under the limit',
      [`${'a'.repeat(512)}\u007fb\r`],
      { value: `${'a'.repeat(511)}b` },
    ],
  ])('accepts %s', async (_name, chunks, expected) => {
    const answer = start();
    for (const chunk of chunks) terminal.emit('data', chunk);
    expect(await settled(answer)).toEqual(expected);
    restored();
  });

  it.each([
    ['513 ASCII bytes', ['a'.repeat(513)]],
    ['a four-byte code point past 512 bytes', [`${'a'.repeat(509)}🔐`]],
    ['the excess before a line end', [`${'a'.repeat(513)}\r`]],
    ['the excess before Ctrl-C', [`${'a'.repeat(513)}\u0003`]],
    ['the excess across chunks', ['a'.repeat(300), 'a'.repeat(300)]],
  ])('refuses %s', async (_name, chunks) => {
    const answer = start();
    for (const chunk of chunks) terminal.emit('data', chunk);
    expect(await settled(answer)).toEqual({
      error: 'OwnerInputError: Password input exceeds 512 bytes',
    });
    restored();
  });
});

import { Readable } from 'node:stream';
import { MfaInputError, parseMfaCodeJson, parseMfaCommand, readMfaCode } from './mfa-input';

const userId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';

describe('MFA-001 CLI bounded input', () => {
  it('accepts explicit prepare and confirm commands without code arguments', () => {
    expect(
      parseMfaCommand([
        'prepare',
        '--user-id',
        userId,
        '--output',
        '/tmp/enrollment.json',
        '--replace',
      ]),
    ).toEqual({ action: 'prepare', userId, output: '/tmp/enrollment.json', replace: true });
    expect(
      parseMfaCommand([
        'confirm',
        '--user-id',
        userId,
        '--candidate-id',
        candidateId,
        '--output',
        '/tmp/recovery.json',
        '--code-stdin',
      ]),
    ).toEqual({
      action: 'confirm',
      userId,
      candidateId,
      output: '/tmp/recovery.json',
      codeStdin: true,
    });
  });

  it.each([
    [],
    ['setup'],
    ['prepare'],
    ['confirm'],
    ['prepare', '--user-id', 'not-uuid', '--output', '/tmp/output'],
    ['prepare', '--user-id', userId, '--output', ''],
    ['prepare', '--user-id', userId, '--output', 'bad\0path'],
    ['prepare', '--user-id', userId, '--output', '/tmp/output', '--replace', '--replace'],
    ['prepare', '--user-id', userId, '--output', '/tmp/output', '--code-stdin'],
    ['prepare', '--user-id', userId, '--output', '/tmp/output', '--candidate-id', candidateId],
    [
      'confirm',
      '--user-id',
      userId,
      '--candidate-id',
      candidateId,
      '--output',
      '/tmp/output',
      '--replace',
    ],
    ['confirm', '--user-id', userId, '--candidate-id', 'not-uuid', '--output', '/tmp/output'],
    ['confirm', '--user-id', userId, '--output', '/tmp/output'],
    [
      'confirm',
      '--user-id',
      userId,
      '--candidate-id',
      candidateId,
      '--output',
      '/tmp/output',
      '--code',
      '012345',
    ],
    [
      'confirm',
      '--user-id',
      userId,
      '--candidate-id',
      candidateId,
      '--output',
      '/tmp/output',
      '--output',
      '/tmp/other',
    ],
    ['confirm', '--user-id', userId, '--candidate-id', candidateId, '--output'],
  ])('rejects unknown, duplicate, missing and secret-bearing arguments %#', (...args) => {
    expect(() => parseMfaCommand(args)).toThrow(MfaInputError);
  });

  it('preserves leading zeroes and accepts the exact 256-byte envelope boundary', () => {
    const json = '{"code":"012345"}';
    expect(parseMfaCodeJson(Buffer.from(json))).toBe('012345');
    expect(parseMfaCodeJson(Buffer.from(json.padEnd(256, ' ')))).toBe('012345');
    expect(() => parseMfaCodeJson(Buffer.from(json.padEnd(257, ' ')))).toThrow(MfaInputError);
  });

  it.each([
    '',
    'null',
    '[]',
    '{}',
    '{broken',
    '{"code":123456}',
    '{"code":true}',
    '{"code":" 123456"}',
    '{"code":"123456 "}',
    '{"code":"12345"}',
    '{"code":"1234567"}',
    '{"code":"１２３４５６"}',
    '{"code":"١٢٣٤٥٦"}',
    '{"code":"123456","extra":true}',
    '{"code":{"toString":"123456"}}',
    '{"code":"12345\\n"}',
    '{"code":"123456\\n"}',
    '{"code":"123456\\r"}',
    '{"code":"123456\\u2028"}',
    '{"code":"123456\\u2029"}',
    '{"code":"12345\\u0000"}',
  ])('rejects malformed or coerced codes without including the input in the error %#', (json) => {
    expect(() => parseMfaCodeJson(Buffer.from(json))).toThrow(MfaInputError);
    try {
      parseMfaCodeJson(Buffer.from(json));
    } catch (error) {
      expect((error as Error).message).not.toContain('123456');
    }
  });

  it('rejects malformed UTF-8', () => {
    expect(() => parseMfaCodeJson(Buffer.from([0xff]))).toThrow(MfaInputError);
  });

  it.each([
    { chunks: ['{"co', 'de":"012345"}\n'], expected: '012345' },
    { chunks: ['{"code":"012345"}', ' '.repeat(257)], expected: null },
  ])('reads bounded streamed JSON without coercing the code %#', async ({ chunks, expected }) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
    Object.defineProperty(process, 'stdin', { configurable: true, value: stream });
    try {
      if (expected === null)
        await expect(readMfaCode(true)).rejects.toThrow('Code input exceeds 256 bytes');
      else expect(await readMfaCode(true)).toBe(expected);
    } finally {
      Object.defineProperty(process, 'stdin', descriptor);
      stream.destroy();
    }
  });

  it('fails noninteractive code entry instead of reading an environment or argv secret', async () => {
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    try {
      await expect(readMfaCode(false)).rejects.toThrow(MfaInputError);
    } finally {
      if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });
});

describe('MFA-001 the error each CLI input gives, checked in order', () => {
  const outcome = (args: string[]) => {
    try {
      return parseMfaCommand(args);
    } catch (error) {
      return error instanceof MfaInputError ? error.message : error;
    }
  };
  const usage =
    'Use mfa-cli.js prepare --user-id UUID --output PATH [--replace] or confirm --user-id UUID --candidate-id UUID --output PATH [--code-stdin]';
  const output = '/tmp/output';

  it.each([
    [[], usage],
    [['setup', '--user-id', userId], usage],
    [['prepare', '--output', output, '--code-stdin'], 'Invalid or duplicate MFA CLI option'],
    [['prepare', '--replace', '--replace'], 'Invalid or duplicate MFA CLI option'],
    [['prepare', '--user-id'], 'Missing MFA CLI option value'],
    [['prepare', '--user-id', '--output', output], 'Missing MFA CLI option value'],
    [['prepare', '--output', 'bad\0path'], 'Invalid or missing owner user ID'],
    [['prepare', '--user-id', 'x', '--output', output], 'Invalid or missing owner user ID'],
    [['prepare', '--user-id', userId], 'Invalid or missing output path'],
    [['prepare', '--user-id', userId, '--output', 'bad\0path'], 'Invalid or missing output path'],
    [['confirm', '--user-id', userId, '--output', output], 'Invalid or missing candidate ID'],
    [
      ['confirm', '--candidate-id', 'x', '--user-id', userId, '--output', output],
      'Invalid or missing candidate ID',
    ],
    [['confirm', '--replace'], 'Invalid or duplicate MFA CLI option'],
  ])('refuses %j with its own message', (args, message) => {
    expect(outcome(args)).toBe(message);
  });

  it('reads the flags in any order and leaves them false when absent', () => {
    expect(outcome(['prepare', '--output', output, '--user-id', userId])).toEqual({
      action: 'prepare',
      userId,
      output,
      replace: false,
    });
    expect(
      outcome([
        'confirm',
        '--code-stdin',
        '--output',
        output,
        '--candidate-id',
        candidateId,
        '--user-id',
        userId,
      ]),
    ).toEqual({ action: 'confirm', userId, candidateId, output, codeStdin: true });
    expect(
      outcome(['confirm', '--user-id', userId, '--candidate-id', candidateId, '--output', output]),
    ).toEqual({ action: 'confirm', userId, candidateId, output, codeStdin: false });
  });
});

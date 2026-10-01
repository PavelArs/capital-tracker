import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { FactorDto } from './factor.dto';

describe('MFA-003-A raw second-factor request types', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: FactorDto });

  const malformed: unknown[] = [
    { kind: 'totp', code: 123456 },
    { kind: 'totp', code: true },
    { kind: 'totp', code: null },
    { kind: 'totp', code: ['123456'] },
    { kind: 'totp', code: { value: '123456' } },
    { kind: 'totp', code: { toString: '123456' } },
    { kind: 'totp' },
    { kind: 1, code: '123456' },
    { kind: true, code: '123456' },
    { kind: null, code: '123456' },
    { kind: ['totp'], code: '123456' },
    { kind: { value: 'totp' }, code: '123456' },
    { kind: { toString: 'totp' }, code: '123456' },
    { code: '123456' },
    { kind: 'totp', code: '123456', token: 'synthetic-not-accepted' },
    { kind: 'recovery', code: 'a'.repeat(36) },
  ];
  it.each(malformed)(
    'rejects malformed JSON-compatible input with400 rather than coercion or500 %#',
    async (body) => {
      await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([
    { kind: 'totp', code: '012345' },
    { kind: 'recovery', code: '01234567-89ABCDEF-01234567-89abcdef' },
  ])('preserves valid factor strings without normalization %#', async (body) => {
    await expect(validate(body)).resolves.toEqual(body);
  });
});

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LoginDto } from './login.dto';

describe('SES-002-D login input boundary', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: LoginDto });

  it.each([
    { email: { toString: 'owner@example.invalid' }, password: 'Synthetic-password-42!' },
    { email: 'owner@example.invalid', password: { toString: 'Synthetic-password-42!' } },
    { email: { value: 'owner@example.invalid' }, password: 'Synthetic-password-42!' },
    { email: ['owner@example.invalid'], password: 'Synthetic-password-42!' },
    { email: 'owner@example.invalid', password: 1234567890123456 },
    { email: 'owner@example.invalid', password: ['Synthetic-password-42!'] },
    { email: 'owner@example.invalid', password: { value: 'Synthetic-password-42!' } },
  ] as unknown[])('rejects non-string credentials with a bounded client error', async (body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes email while preserving every password character', async () => {
    const password = '  Synthetic-password-42! e\u0301  ';
    await expect(validate({ email: ' OWNER@EXAMPLE.INVALID ', password })).resolves.toMatchObject({
      email: 'owner@example.invalid',
      password,
    });
  });
});

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('OPEN-004 raw accounting boundary before persistence', () => {
  const source = new DataSource({ type: 'postgres' });
  const service = new AccountingService(source);
  it('rejects a malformed body before any database initialization', async () => {
    await expect(
      service.createAccount(owner, { requestId: owner, name: { toString: 'unsafe' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveOpening(owner, owner, { expectedRevision: '0' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(source.isInitialized).toBe(false);
  });
  it('keeps actual controller body metadata opaque to global implicit conversion', async () => {
    const metadata = Reflect.getMetadata(
      'design:paramtypes',
      AccountingController.prototype,
      'createAccount',
    );
    expect(metadata[1]).toBe(Object);
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const original = { requestId: owner, name: { toString: 'unsafe' } };
    const raw = await pipe.transform(original, { type: 'body', metatype: metadata[1] });
    expect(raw).toBe(original);
    await expect(service.createAccount(owner, raw)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects invalid typed query inputs before connecting', async () => {
    await expect(service.listAccounts(owner, { limit: 1.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.listInstruments(owner, { limit: 101 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.listOpenings(owner, owner, { beforeRevision: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(source.isInitialized).toBe(false);
  });
});

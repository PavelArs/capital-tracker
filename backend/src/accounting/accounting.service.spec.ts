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

describe('BROKER-LIST-CONNECTION the account list says which broker accounts read with a token', () => {
  it('gives the provider of a connected account and null for any other, with no token', async () => {
    const source = new DataSource({ type: 'postgres' });
    const row = (id: string, connection: string | null) => ({
      id,
      ownerId: owner,
      name: 'Synthetic broker',
      kind: null,
      assetClass: 'broker',
      currentRevision: 1,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      canonicalPayload: 'synthetic',
      connection,
    });
    const query = jest
      .spyOn(source, 'query')
      .mockResolvedValue([
        row('11111111-1111-4111-8111-111111111111', 'tbank'),
        row('22222222-2222-4222-8222-222222222222', null),
      ]);
    const { items } = await new AccountingService(source).listAccounts(owner, { limit: 10 });
    expect(String(query.mock.calls[0][0])).toContain('LEFT JOIN broker_connections');
    expect(items.map((item) => (item as { connection?: unknown }).connection)).toEqual([
      'tbank',
      null,
    ]);
    expect(items[0]).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Synthetic broker',
      kind: null,
      assetClass: 'broker',
      connection: 'tbank',
      currentRevision: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  });
});

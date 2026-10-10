import { ArgumentsHost, BadRequestException, ConflictException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './global-exception.filter';

const dependent = {
  operationId: 'trade:00000000-0000-4000-8000-000000000001',
  accountId: '00000000-0000-4000-8000-000000000002',
  instrumentId: '00000000-0000-4000-8000-000000000003',
  occurredAt: '2025-04-01T00:00:00.000Z',
};

function run(exception: unknown) {
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  response.status.mockReturnValue(response);
  const request = { url: '/accounting/accounts/x/trades/y/void?z=1', method: 'POST', ip: '' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter(logger as unknown as PinoLogger).catch(exception, host);
  return response.json.mock.calls[0][0] as Record<string, unknown>;
}

describe('GlobalExceptionFilter', () => {
  it('OPS-DELETE-GUARD keeps the dependent operation of a 409', () => {
    const body = run(
      new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'A later operation depends on this trade',
        dependent,
      }),
    );
    expect(body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        message: 'A later operation depends on this trade',
        error: 'Conflict',
        path: '/accounting/accounts/x/trades/y/void',
        dependent,
      }),
    );
  });

  it('drops dependent from other statuses and other response fields', () => {
    const conflict = run(new ConflictException({ message: 'Stale', private: 'marker' }));
    expect(conflict).not.toHaveProperty('dependent');
    expect(conflict).not.toHaveProperty('private');
    const invalid = run(new BadRequestException({ message: 'Bad', dependent }));
    expect(invalid).not.toHaveProperty('dependent');
    expect(run(new ConflictException({ message: 'List', dependent: ['x'] }))).not.toHaveProperty(
      'dependent',
    );
  });

  it('XFER-COVER keeps the account a 409 names as starting after the change, and nothing else', () => {
    const coverage = {
      accountId: '00000000-0000-4000-8000-000000000002',
      coverageFrom: '2026-10-05T00:00:00.000Z',
    };
    const body = run(
      new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'The records of an account start after this entry',
        coverage: { ...coverage, private: 'marker' },
      }),
    );
    expect(body).toEqual(expect.objectContaining({ statusCode: 409, coverage }));
    expect(run(new BadRequestException({ message: 'Bad', coverage }))).not.toHaveProperty(
      'coverage',
    );
    expect(
      run(new ConflictException({ message: 'List', coverage: { accountId: 1 } })),
    ).not.toHaveProperty('coverage');
    const unstarted = { accountId: coverage.accountId, coverageFrom: null };
    expect(run(new ConflictException({ message: 'None', coverage: unstarted }))).toEqual(
      expect.objectContaining({ coverage: unstarted }),
    );
  });
  it('OBS-ERR-1 logs a server error with its request id and stack frames but not its message', () => {
    const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
    response.status.mockReturnValue(response);
    const request = { url: '/accounting/operations?x=1', method: 'GET', ip: '', id: 'req-1' };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost;
    const failure = new Error('duplicate key value (owner=private-marker)');

    new GlobalExceptionFilter(logger as unknown as PinoLogger).catch(failure, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [fields] = logger.error.mock.calls[0];
    expect(fields).toEqual(
      expect.objectContaining({ requestId: 'req-1', url: '/accounting/operations' }),
    );
    expect(fields.stack).toContain('global-exception.filter.spec');
    expect(JSON.stringify(fields)).not.toContain('private-marker');
  });
});

import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { Controller, Get, Logger as NestLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger, LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from './logging';

@Controller('probe')
class ProbeController {
  @Get()
  read() {
    // A service-level log line, written while the request is handled.
    new NestLogger('Probe').log('inside the request');
    return { ok: true };
  }
}

describe('OBS-LOGS', () => {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      done();
    },
  });

  it('OBS-LOG-1 logs JSON with a string level and one request id on every line of a request', async () => {
    const module = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: [pinoHttpOptions(true), stream] })],
      controllers: [ProbeController],
    }).compile();
    const app = module.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    await app.listen(0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/probe?secret=1`,
        {
          headers: { authorization: 'Bearer secret' },
        },
      );
      const requestId = response.headers.get('x-request-id');
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const inside = lines.find((line) => line.msg === 'inside the request');
      const completed = lines.find((line) => line.msg === 'request completed');
      expect(inside).toEqual(expect.objectContaining({ level: 'info', service: 'backend' }));
      expect(inside).toEqual(
        expect.objectContaining({ req: expect.objectContaining({ id: requestId }) }),
      );
      expect(completed).toEqual(
        expect.objectContaining({
          level: 'info',
          res: { statusCode: 200 },
          req: expect.objectContaining({ id: requestId, url: '/probe' }),
        }),
      );
      expect(typeof completed?.durationMs).toBe('number');
      expect(String(completed?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(JSON.stringify(lines)).not.toContain('secret');
    } finally {
      await app.close();
    }
  });
});

import { MemoryHealthIndicator, TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('/health/details reports only the database and memory heap', async () => {
    const up = (key: string) => ({ [key]: { status: 'up' } });
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    })
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue({ pingCheck: up })
      .overrideProvider(MemoryHealthIndicator)
      .useValue({ checkHeap: up })
      .compile();

    const result = await moduleRef.get(HealthController).check();

    expect(result.status).toBe('ok');
    expect(Object.keys(result.info ?? {}).sort()).toEqual(['database', 'memory_heap']);
    expect(Object.keys(result.details).sort()).toEqual(['database', 'memory_heap']);
  });
});

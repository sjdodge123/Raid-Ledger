import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import request from 'supertest';
import { HubHealthResponseSchema } from '@raid-ledger/contract';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';

describe('relay-hub health routes (integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 {status, schemaVersions}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', schemaVersions: [1] });
    expect(HubHealthResponseSchema.safeParse(res.body).success).toBe(true);
  });

  it('GET /api/v1/health/live returns 200 {status: ok}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it.each(['/api/v1/nope', '/v1/health', '/api/health'])(
    'GET %s returns 404',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    },
  );
});

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RateLimitModule } from './throttler.module';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';
import * as supertest from 'supertest';

@Controller('test')
class TestController {
  @Get()
  hello() {
    return { ok: true };
  }
}

describe('RateLimitModule', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), RateLimitModule],
      controllers: [TestController],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalFilters(new ThrottlerExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allow normal requests through', async () => {
    const res = await supertest.default(app.getHttpServer()).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('ThrottlerExceptionFilter', () => {
  it('should format 429 response with retryAfter field', () => {
    const filter = new ThrottlerExceptionFilter();
    const mockJson = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
      }),
    };

    filter.catch(new (jest.fn())(), mockHost as any);

    expect(mockStatus).toHaveBeenCalledWith(429);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      retryAfter: 60,
    });
  });
});

/**
 * ROK-1845 — POST /notifications/:id/read validates `:id` as a uuid. A
 * malformed id (the shape a hostile `?notif=` link carries) is a 400 and never
 * reaches the service.
 */
import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

const VALID_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

describe('POST /notifications/:id/read — id validation (ROK-1845)', () => {
  let app: INestApplication;
  const markRead = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    markRead.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        { provide: NotificationService, useValue: { markRead } },
        { provide: DiscordBotClientService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: unknown }>().user = { id: 7 };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (id: string) =>
    supertest(app.getHttpServer() as Server).post(`/notifications/${id}/read`);

  it.each(['not-a-uuid', '123', 'x'.repeat(36)])(
    'returns 400 for the malformed id %s',
    async (id) => {
      const res = await post(id);
      expect(res.status).toBe(400);
      expect(markRead).not.toHaveBeenCalled();
    },
  );

  it('marks a uuid id read for the caller', async () => {
    const res = await post(VALID_ID);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(markRead).toHaveBeenCalledWith(7, VALID_ID);
  });
});

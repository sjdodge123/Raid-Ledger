/**
 * ROK-1435 (L5): GET/PUT /admin/settings/discord-bot/weekly-digest — defaults,
 * persistence, the admin guard, and contract validation (day enum, hour 0–23).
 */
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { AdminGuard } from '../auth/admin.guard';
import { WeeklyDigestSettingsController } from './weekly-digest-settings.controller';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema';

const URL = '/admin/settings/discord-bot/weekly-digest';
const VALID = {
  enabled: true,
  channelId: '123456789012345678',
  day: 3,
  hour: 18,
};

describe('WeeklyDigestSettingsController (ROK-1435 L5)', () => {
  let app: INestApplication;
  const store = new Map<string, string>();
  const guard = { allow: true };
  let zone: string | null = 'America/New_York';
  const svc = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
    getDefaultTimezone: jest.fn(() => Promise.resolve(zone)),
  };

  beforeEach(async () => {
    store.clear();
    guard.allow = true;
    zone = 'America/New_York';
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [WeeklyDigestSettingsController],
      providers: [{ provide: SettingsService, useValue: svc }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => guard.allow })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => supertest(app.getHttpServer() as Server);

  it('is guarded by the JWT and admin guards', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      WeeklyDigestSettingsController,
    ) as unknown[];
    expect(guards).toContain(AdminGuard);
    expect(guards).toHaveLength(2);
  });

  it('rejects a non-admin on GET and PUT with 403 and writes nothing', async () => {
    guard.allow = false;
    await http().get(URL).expect(403);
    await http().put(URL).send(VALID).expect(403);
    expect(svc.set).not.toHaveBeenCalled();
  });

  it('GET returns the defaults when nothing is stored: off, Monday 09:00, fallback channel', async () => {
    const res = await http().get(URL).expect(200);
    expect(res.body).toEqual({
      enabled: false,
      channelId: null,
      day: 1,
      hour: 9,
      timezone: 'America/New_York',
    });
  });

  it('GET reports UTC when the community timezone is unset or bogus', async () => {
    zone = 'Not/AZone';
    const res = await http().get(URL).expect(200);
    expect(res.body.timezone).toBe('UTC');
  });

  it('PUT persists all four settings and echoes them back', async () => {
    const res = await http().put(URL).send(VALID).expect(200);
    expect(res.body).toEqual({ ...VALID, timezone: 'America/New_York' });
    expect(store.get(SETTING_KEYS.WEEKLY_DIGEST_ENABLED)).toBe('true');
    expect(store.get(SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID)).toBe(
      VALID.channelId,
    );
    expect(store.get(SETTING_KEYS.WEEKLY_DIGEST_DAY)).toBe('3');
    expect(store.get(SETTING_KEYS.WEEKLY_DIGEST_HOUR)).toBe('18');
  });

  it('PUT with channelId null clears the dedicated channel (fallback to default)', async () => {
    store.set(SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID, 'old-channel');
    const res = await http()
      .put(URL)
      .send({ ...VALID, channelId: null })
      .expect(200);
    expect(res.body.channelId).toBeNull();
    expect(store.has(SETTING_KEYS.WEEKLY_DIGEST_CHANNEL_ID)).toBe(false);
  });

  it.each([
    ['day 7', { day: 7 }],
    ['day -1', { day: -1 }],
    ['day as a name', { day: 'monday' }],
    ['hour 24', { hour: 24 }],
    ['hour -1', { hour: -1 }],
    ['fractional hour', { hour: 9.5 }],
    ['enabled missing', { enabled: undefined }],
  ])('PUT rejects %s with 400 and writes nothing', async (_label, patch) => {
    const res = await http()
      .put(URL)
      .send({ ...VALID, ...patch })
      .expect(400);
    expect(res.body.message).toBe('Validation failed');
    expect(svc.set).not.toHaveBeenCalled();
    expect(svc.delete).not.toHaveBeenCalled();
  });

  it('PUT accepts the boundary slots Sunday 00:00 and Saturday 23:00', async () => {
    await http()
      .put(URL)
      .send({ ...VALID, day: 0, hour: 0 })
      .expect(200);
    const res = await http()
      .put(URL)
      .send({ ...VALID, day: 6, hour: 23 })
      .expect(200);
    expect(res.body).toMatchObject({ day: 6, hour: 23 });
  });
});

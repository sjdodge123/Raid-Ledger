/**
 * ROK-2259 — flush applies buffered events in the order they were buffered,
 * so an attribution adapter's overlap check (open voice row vs new presence
 * row) never sees a voice row whose close is still waiting in the buffer.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { GameActivityService } from './game-activity.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { GameTasteService } from '../../game-taste/game-taste.service';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type {
  SessionCloseEvent,
  SessionOpenEvent,
} from './game-activity.helpers';

const calls: string[] = [];

jest.mock('./game-activity.helpers', () => ({
  ...jest.requireActual<object>('./game-activity.helpers'),
  resolveGameNames: jest.fn().mockResolvedValue(undefined),
  processOpenEvents: jest.fn((_db: unknown, opens: SessionOpenEvent[]) => {
    for (const ev of opens) calls.push(`open:${ev.discordActivityName}`);
    return Promise.resolve(opens);
  }),
  processCloseEvents: jest.fn((_db: unknown, closes: SessionCloseEvent[]) => {
    for (const ev of closes) calls.push(`close:${ev.discordActivityName}`);
    return Promise.resolve();
  }),
}));

jest.mock('./game-activity-attribution.helpers', () => ({
  attributeOpenSessions: jest.fn((opens: SessionOpenEvent[]) => {
    for (const ev of opens) calls.push(`attribute:${ev.discordActivityName}`);
    return Promise.resolve();
  }),
  notifyStoredOpens: jest.fn((stored: SessionOpenEvent[]) => {
    for (const ev of stored) calls.push(`notify:${ev.discordActivityName}`);
    return Promise.resolve();
  }),
}));

async function createService(): Promise<GameActivityService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GameActivityService,
      { provide: DrizzleAsyncProvider, useValue: createDrizzleMock() },
      { provide: CronJobService, useValue: { executeWithTracking: jest.fn() } },
      { provide: GameTasteService, useValue: { enqueueRecompute: jest.fn() } },
    ],
  }).compile();
  const service = module.get<GameActivityService>(GameActivityService);
  service.onApplicationShutdown();
  return service;
}

const VOICE = 'World of Warcraft: Forever';
const RAW = 'World of Warcraft Classic';

describe('GameActivityService — flush order (ROK-2259)', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('closes a voice row left before the presence start ahead of attributing it', async () => {
    const service = await createService();
    service.bufferStop(1, VOICE, new Date('2026-11-18T10:00:00Z'), 'voice');
    service.bufferStart(1, RAW, new Date('2026-11-18T10:00:10Z'));

    await service.flush();

    expect(calls).toEqual([
      `close:${VOICE}`,
      `attribute:${RAW}`,
      `open:${RAW}`,
      `notify:${RAW}`,
    ]);
  });

  it('still opens before closing a session started and ended in one window', async () => {
    const service = await createService();
    service.bufferStart(1, RAW, new Date('2026-11-18T10:00:00Z'));
    service.bufferStop(1, RAW, new Date('2026-11-18T10:00:20Z'));

    await service.flush();

    expect(calls).toEqual([
      `attribute:${RAW}`,
      `open:${RAW}`,
      `notify:${RAW}`,
      `close:${RAW}`,
    ]);
  });

  it('notifies a voice open before attributing a raw open buffered after it', async () => {
    const service = await createService();
    service.bufferStart(1, VOICE, new Date('2026-11-18T10:00:00Z'), 'voice');
    service.bufferStart(1, RAW, new Date('2026-11-18T10:00:10Z'));

    await service.flush();

    expect(calls).toEqual([
      `attribute:${VOICE}`,
      `open:${VOICE}`,
      `notify:${VOICE}`,
      `attribute:${RAW}`,
      `open:${RAW}`,
      `notify:${RAW}`,
    ]);
  });
});

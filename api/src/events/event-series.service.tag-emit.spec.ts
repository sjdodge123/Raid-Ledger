/**
 * ROK-1832 OQ-3 — EventSeriesService.update emits `hub.event-tagged` once per
 * occurrence that `findSeriesTagTargets` reports as newly tagged; a re-save
 * with the same group (no targets) emits nothing. Announced/started filtering
 * lives in the late-tag listener, not here.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import { HUB_NOTIFICATION_EVENTS } from '../notifications/hub-notification.constants';
import { SIGNUP_CONFIRMATIONS_RESET } from '../discord-bot/discord-bot.constants';
import { EventSeriesService } from './event-series.service';
import { findSeriesTagTargets } from './event-group-tag.helpers';
import { updateSeriesEvents } from './event-series.helpers';
import type { UpdateEventDto } from '@raid-ledger/contract';

jest.mock('./event-group-tag.helpers', () => ({
  findSeriesTagTargets: jest.fn(),
}));
jest.mock('./event-series.helpers', () => ({
  updateSeriesEvents: jest.fn(),
  deleteSeriesEvents: jest.fn(),
  cancelSeriesEvents: jest.fn(),
}));
jest.mock('./event-find.helpers', () => ({
  findOneEvent: jest.fn().mockRejectedValue(new Error('not needed')),
}));

const targets = jest.mocked(findSeriesTagTargets);
const updated = jest.mocked(updateSeriesEvents);

function build(): { service: EventSeriesService; emit: jest.Mock } {
  const emit = jest.fn();
  const service = new EventSeriesService(
    {} as PostgresJsDatabase<typeof schema>,
    {} as NotificationService,
    { emit } as unknown as EventEmitter2,
  );
  return { service, emit };
}

function taggedEmits(emit: jest.Mock): unknown[] {
  return emit.mock.calls
    .filter((c: unknown[]) => c[0] === HUB_NOTIFICATION_EVENTS.EVENT_TAGGED)
    .map((c: unknown[]) => c[1]);
}

const dto: UpdateEventDto = { guildId: 7 };

describe('EventSeriesService.update — hub.event-tagged emit loop', () => {
  beforeEach(() => {
    targets.mockReset();
    updated.mockReset();
  });

  it('one newly tagged occurrence → exactly one emit for it', async () => {
    targets.mockResolvedValue([42]);
    updated.mockResolvedValue([41, 42]);
    const { service, emit } = build();
    await service.update(41, 1, false, 'all', dto);
    expect(taggedEmits(emit)).toEqual([{ eventId: 42 }]);
  });

  it('a same-group re-save (no new targets) → no emit', async () => {
    targets.mockResolvedValue([]);
    updated.mockResolvedValue([41, 42]);
    const { service, emit } = build();
    await service.update(41, 1, false, 'all', dto);
    expect(taggedEmits(emit)).toEqual([]);
  });
});

describe('EventSeriesService.update — ROK-2271 Codex P2-3', () => {
  beforeEach(() => {
    targets.mockReset();
    updated.mockReset();
  });

  it('a startTime in the dto emits no reset itself (the helper signals a real one)', async () => {
    targets.mockResolvedValue([]);
    updated.mockResolvedValue([41, 42]);
    const { service, emit } = build();
    await service.update(41, 1, false, 'all', {
      startTime: '2026-03-10T18:00:00Z',
    });
    const resets = emit.mock.calls.filter(
      (c: unknown[]) => c[0] === SIGNUP_CONFIRMATIONS_RESET,
    );
    expect(resets).toEqual([]);
  });
});

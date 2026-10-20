/**
 * ROK-1832 D7/D9 — `GuildProfileService.update` emits the leader-post trigger
 * only when the GM post changed to a non-empty value.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { GuildAccessService } from './guild-access.service';
import { GuildProfileService } from './guild-profile.service';
import { HUB_NOTIFICATION_EVENTS } from '../notifications/hub-notification.constants';
import { findProfileRow } from './guild-profile.queries';

jest.mock('./guild-core.queries', () => ({
  findGuild: jest.fn().mockResolvedValue({ id: 7 }),
}));
jest.mock('./guild-profile.queries', () => ({
  findProfileRow: jest.fn(),
  findUsername: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue(undefined),
}));

const findRow = jest.mocked(findProfileRow);
const actor = { id: 3, role: 'member' } as const;

function build(): { service: GuildProfileService; emit: jest.Mock } {
  const emit = jest.fn();
  const emitter = { emit } as unknown as EventEmitter2;
  const db = {} as PostgresJsDatabase<typeof schema>;
  const access = {} as GuildAccessService;
  return { service: new GuildProfileService(db, access, emitter), emit };
}

function stored(gmPost: string | null): void {
  findRow.mockResolvedValue(
    gmPost === null ? undefined : ({ gmPost } as never),
  );
}

describe('GuildProfileService.update — leader-post trigger', () => {
  beforeEach(() => findRow.mockReset());

  it('emits once when the post changes to a non-empty value', async () => {
    stored('Old post');
    const { service, emit } = build();
    await service.update(actor, 7, { gmPost: 'Raid moved to Friday' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(HUB_NOTIFICATION_EVENTS.LEADER_POST, {
      guildId: 7,
      actorId: 3,
      gmPost: 'Raid moved to Friday',
    });
  });

  it('does not emit when the post is unchanged', async () => {
    stored('Same post');
    const { service, emit } = build();
    await service.update(actor, 7, { gmPost: 'Same post' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not emit when the post is cleared', async () => {
    stored('Old post');
    const { service, emit } = build();
    await service.update(actor, 7, { gmPost: null });
    await service.update(actor, 7, { gmPost: '   ' });
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    ['rules', { rules: [] }],
    ['links', { links: [] }],
    ['rules + links', { rules: [], links: [] }],
  ])('D9: a %s-only patch emits nothing', async (_label, body) => {
    stored('Old post');
    const { service, emit } = build();
    await service.update(actor, 7, body);
    expect(emit).not.toHaveBeenCalled();
  });
});

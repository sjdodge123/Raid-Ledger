/**
 * ROK-1787: core guild-tag gate — resolves the EVENT_GUILD_TAGGER adapter and
 * keeps an event's guild tag consistent with its game on update.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  EventGuildTagService,
  GUILD_GAME_MISMATCH,
  GUILD_TAGGING_UNAVAILABLE,
} from './event-guild-tag.service';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';

const actor = { id: 7, role: 'member' as const };
const base = {
  title: 'Raid',
  startTime: '2026-11-01T19:00:00.000Z',
  endTime: '2026-11-01T22:00:00.000Z',
};

function setup(opts: {
  tagger?: { pluginSlug: string; assertCanTag: jest.Mock } | undefined;
  active?: boolean;
  existing?: {
    gameId: number | null;
    guildId: number | null;
    creatorId?: number;
  };
}) {
  const getAdapter = jest.fn().mockReturnValue(opts.tagger);
  const registry = { getAdapter, isActive: () => opts.active ?? true };
  const limit = jest
    .fn()
    .mockResolvedValue(
      opts.existing ? [{ creatorId: actor.id, ...opts.existing }] : [],
    );
  const chain = { from: () => chain, where: () => chain, limit };
  const db = { select: jest.fn(() => chain) };
  const svc = new EventGuildTagService(registry as never, db as never);
  return { svc, getAdapter, db };
}

function tagger() {
  return {
    pluginSlug: 'blizzard',
    assertCanTag: jest.fn().mockResolvedValue(undefined),
  };
}

describe('EventGuildTagService.assertCreate', () => {
  it('skips the adapter when no guildId is sent', async () => {
    const t = tagger();
    const { svc, getAdapter } = setup({ tagger: t });
    await svc.assertCreate(actor, { ...base, gameId: 2 });
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it('calls the adapter with actor, guildId and gameId', async () => {
    const t = tagger();
    const { svc, getAdapter } = setup({ tagger: t });
    await svc.assertCreate(actor, { ...base, gameId: 2, guildId: 9 });
    expect(getAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.EVENT_GUILD_TAGGER,
      '*',
    );
    expect(t.assertCanTag).toHaveBeenCalledWith(actor, 9, 2);
  });

  it('400s when no tagger adapter is registered', async () => {
    const { svc } = setup({ tagger: undefined });
    await expect(
      svc.assertCreate(actor, { ...base, gameId: 2, guildId: 9 }),
    ).rejects.toThrow(new BadRequestException(GUILD_TAGGING_UNAVAILABLE));
  });

  it('400s when the owning plugin is inactive', async () => {
    const t = tagger();
    const { svc } = setup({ tagger: t, active: false });
    await expect(
      svc.assertCreate(actor, { ...base, gameId: 2, guildId: 9 }),
    ).rejects.toThrow(GUILD_TAGGING_UNAVAILABLE);
    expect(t.assertCanTag).not.toHaveBeenCalled();
  });

  it('propagates the adapter refusal', async () => {
    const t = tagger();
    t.assertCanTag.mockRejectedValue(new ForbiddenException('nope'));
    const { svc } = setup({ tagger: t });
    await expect(
      svc.assertCreate(actor, { ...base, gameId: 2, guildId: 9 }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('EventGuildTagService.assertUpdate', () => {
  it('clears (null) without loading the event or asking the adapter', async () => {
    const t = tagger();
    const { svc, db } = setup({ tagger: t });
    await svc.assertUpdate(actor, 1, { guildId: null });
    expect(db.select).not.toHaveBeenCalled();
    expect(t.assertCanTag).not.toHaveBeenCalled();
  });

  it('re-checks a new tag against the existing game', async () => {
    const t = tagger();
    const existing = { gameId: 3, guildId: null };
    const { svc } = setup({ tagger: t, existing });
    await svc.assertUpdate(actor, 1, { guildId: 9 });
    expect(t.assertCanTag).toHaveBeenCalledWith(actor, 9, 3);
  });

  it('re-checks a new tag against the new game when both change', async () => {
    const t = tagger();
    const existing = { gameId: 3, guildId: 9 };
    const { svc } = setup({ tagger: t, existing });
    await svc.assertUpdate(actor, 1, { guildId: 9, gameId: 4 });
    expect(t.assertCanTag).toHaveBeenCalledWith(actor, 9, 4);
  });

  it('refuses a game change that strands the existing tag', async () => {
    const { svc } = setup({
      tagger: tagger(),
      existing: { gameId: 3, guildId: 9 },
    });
    await expect(svc.assertUpdate(actor, 1, { gameId: 4 })).rejects.toThrow(
      new BadRequestException(GUILD_GAME_MISMATCH),
    );
  });

  it('allows a game change on an untagged event', async () => {
    const { svc } = setup({
      tagger: tagger(),
      existing: { gameId: 3, guildId: null },
    });
    await expect(
      svc.assertUpdate(actor, 1, { gameId: 4 }),
    ).resolves.toBeUndefined();
  });

  it('leaves a missing event to the event service (no throw)', async () => {
    const t = tagger();
    const { svc } = setup({ tagger: t });
    await svc.assertUpdate(actor, 999, { guildId: 9 });
    expect(t.assertCanTag).not.toHaveBeenCalled();
  });
});

describe('EventGuildTagService.assertUpdate — ownership first', () => {
  it('leaves a non-owner to the event service owner 403 (no guild answer leaks)', async () => {
    const t = tagger();
    const existing = { gameId: 3, guildId: 9, creatorId: 99 };
    const { svc } = setup({ tagger: t, existing });
    await expect(
      svc.assertUpdate(actor, 1, { guildId: 12, gameId: 4 }),
    ).resolves.toBeUndefined();
    expect(t.assertCanTag).not.toHaveBeenCalled();
  });

  it("still checks an admin editing someone else's event", async () => {
    const t = tagger();
    const admin = { id: 1, role: 'admin' as const };
    const existing = { gameId: 3, guildId: null, creatorId: 99 };
    const { svc } = setup({ tagger: t, existing });
    await svc.assertUpdate(admin, 1, { guildId: 9 });
    expect(t.assertCanTag).toHaveBeenCalledWith(admin, 9, 3);
  });
});

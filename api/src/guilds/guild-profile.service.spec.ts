/**
 * ROK-1868 A3 — `GuildProfileService`: `gmPost` is DERIVED from the newest
 * hub post (and `latestPost` rides along); a legacy `PATCH profile {gmPost}`
 * is a 400 pointing at `POST /guilds/:id/posts`; rules/links still save and
 * nothing in this service notifies any more (the emit moved to post create).
 */
import { BadRequestException } from '@nestjs/common';
import type { HubPost } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { GuildAccessService } from './guild-access.service';
import { GuildProfileService } from './guild-profile.service';
import { findProfileRow, upsertProfile } from './guild-profile.queries';
import type { HubPostsService } from './posts/hub-posts.service';

jest.mock('./guild-core.queries', () => ({
  findGuild: jest.fn().mockResolvedValue({ id: 7 }),
}));
jest.mock('./guild-profile.queries', () => ({
  findProfileRow: jest.fn(),
  upsertProfile: jest.fn().mockResolvedValue(undefined),
}));

const actor = { id: 3, role: 'member' } as const;
const person = (name: string) => ({
  userId: 3,
  displayName: name,
  avatarUrl: null,
});

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 11,
    guildId: 7,
    body: '**Raid** Tuesday',
    author: person('Gm'),
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T11:00:00.000Z',
    editedBy: null,
    relay: null,
    ...over,
  };
}

function build(latest: HubPost | null): {
  service: GuildProfileService;
  latestFn: jest.Mock;
} {
  const latestFn = jest.fn().mockResolvedValue(latest);
  const posts = { latest: latestFn } as unknown as HubPostsService;
  const access = {
    canView: jest.fn().mockResolvedValue(true),
  } as unknown as GuildAccessService;
  const db = {} as PostgresJsDatabase<typeof schema>;
  return { service: new GuildProfileService(db, access, posts), latestFn };
}

beforeEach(() => {
  jest.mocked(findProfileRow).mockResolvedValue({
    gmPost: 'legacy text that must NOT be read',
    gmPostUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
    rules: null,
    links: null,
  } as never);
});
afterEach(() => jest.clearAllMocks());

describe('GuildProfileService.get — gmPost derived from the newest post', () => {
  it('maps the newest post to gmPost and carries it as latestPost', async () => {
    const latest = post();
    const { service } = build(latest);
    const out = await service.get(actor, 7);
    expect(out.gmPost).toEqual({
      body: '**Raid** Tuesday',
      updatedAt: '2026-10-20T11:00:00.000Z',
      updatedBy: 'Gm',
    });
    expect(out.latestPost).toEqual(latest);
  });

  it('names the last editor when the post was edited', async () => {
    const { service } = build(post({ editedBy: person('Officer') }));
    expect((await service.get(actor, 7)).gmPost?.updatedBy).toBe('Officer');
  });

  it('is null for both when the hub has no posts (legacy column ignored)', async () => {
    const { service } = build(null);
    const out = await service.get(actor, 7);
    expect(out.gmPost).toBeNull();
    expect(out.latestPost).toBeNull();
  });
});

describe('GuildProfileService.update — legacy gmPost rejected', () => {
  it.each([
    ['text', 'Raid moved'],
    ['null', null],
  ])(
    'a gmPost key (%s) is a 400 pointing at POST /guilds/:id/posts',
    async (_label, gmPost) => {
      const { service } = build(null);
      const err = await service
        .update(actor, 7, { gmPost })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe(
        'The leader post moved to POST /guilds/:id/posts',
      );
      expect(upsertProfile).not.toHaveBeenCalled();
    },
  );

  it('rules/links still save and return the derived profile', async () => {
    const { service } = build(post());
    const out = await service.update(actor, 7, { rules: [], links: [] });
    expect(upsertProfile).toHaveBeenCalledWith(
      {},
      7,
      expect.not.objectContaining({ gmPost: expect.anything() }),
    );
    expect(out.gmPost?.body).toBe('**Raid** Tuesday');
  });
});

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { GuildAccessService, type GuildActor } from './guild-access.service';
import type { HubKindRegistry } from './hub-kind.registry';
import { HubTaggableService } from './hub-taggable.service';

jest.mock('./crest/hub-crest.resolve', () => ({
  resolveGuildCrest: jest.fn().mockReturnValue(null),
}));

const MEMBER: GuildActor = { id: 50, role: 'member' };

function hubRow(id: number, kind = 'community'): schema.GuildSelect {
  return {
    id,
    gameId: 3,
    kind,
    name: `Hub ${id}`,
    hiddenAt: null,
  } as unknown as schema.GuildSelect;
}

/** Hubs 1–3 of one kind; the actor leads 1, is a plain member of 2, not in 3. */
function setup(rows = [hubRow(1), hubRow(2), hubRow(3)]) {
  const ladder: Record<number, string> = { 1: 'leader', 2: 'member' };
  const adapter = {
    memberGroupIds: jest.fn().mockResolvedValue([1, 2]),
    resolveLadder: jest.fn((_actor: GuildActor, id: number) =>
      Promise.resolve(ladder[id] ?? 'visitor'),
    ),
  };
  const hubKinds = {
    resolve: jest.fn().mockReturnValue(adapter),
    require: jest.fn().mockReturnValue(adapter),
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(rows) }),
      }),
    }),
  } as unknown as PostgresJsDatabase<typeof schema>;
  const registry = hubKinds as unknown as HubKindRegistry;
  const access = new GuildAccessService(db, registry);
  const svc = new HubTaggableService(db, access, registry);
  return { svc, adapter };
}

describe('HubTaggableService.listForGame (L3884)', () => {
  it('offers a non-staff viewer only the hubs they can edit', async () => {
    const { svc } = setup();
    const result = await svc.listForGame(MEMBER, 3);
    expect(result.hubs.map((h) => h.id)).toEqual([1]);
  });

  it('reads membership once per kind, not a ladder per hub', async () => {
    const { svc, adapter } = setup();
    await svc.listForGame(MEMBER, 3);
    expect(adapter.memberGroupIds).toHaveBeenCalledTimes(1);
    expect(adapter.resolveLadder).toHaveBeenCalledTimes(2);
    expect(adapter.resolveLadder).not.toHaveBeenCalledWith(MEMBER, 3);
  });

  it('resolves no ladder when the viewer is in none of the hubs', async () => {
    const { svc, adapter } = setup();
    adapter.memberGroupIds.mockResolvedValue([]);
    const result = await svc.listForGame(MEMBER, 3);
    expect(result.hubs).toEqual([]);
    expect(adapter.resolveLadder).not.toHaveBeenCalled();
  });

  it('offers staff every live hub without any membership read', async () => {
    const { svc, adapter } = setup();
    const result = await svc.listForGame({ id: 1, role: 'admin' }, 3);
    expect(result.hubs.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(adapter.memberGroupIds).not.toHaveBeenCalled();
  });
});

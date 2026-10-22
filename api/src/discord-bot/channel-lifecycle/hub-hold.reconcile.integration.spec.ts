/**
 * ROK-1873 (ROK-1428 L11, X2 + A8/D8) — the community-hub hold through a
 * real `reconcile()` tick: an approved hub with no managed channel gets one
 * (and the hub is auto-linked to it); an active hub keeps its game's quiet
 * auto channel open; the hold ends when the hub goes dormant, hidden or
 * archived. FLEET-ONLY (Postgres + the Redis sidecar).
 *
 * Time: the hub's approval is back-dated in the DB (as the sibling
 * `hub-activity.integration.spec.ts` does) rather than faking the clock —
 * the dormancy window is compared in SQL against `created_at` /
 * `reviewed_at`, and a faked JS clock would also skew the Redis lease and
 * postgres.js timers this tick runs on.
 *
 * Discord ops are spied on the module object (memory
 * `reference_integration_jest_mock_singleton_app`); the bot client is stubbed.
 */
import { eq } from 'drizzle-orm';
import type { Guild } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from '../../guilds/community/community-proposals.queries';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import * as ops from './channel-lifecycle.discord-ops';
import { ChannelLifecycleService } from './channel-lifecycle.service';

const GUILD = 'rok1873-guild';
const DAY = 86_400_000;
const live = { dryRun: false, trigger: 'manual' as const };
const ADDED = { everyoneSend: true, everyoneView: false, botView: false };
const guild = {
  id: GUILD,
  channels: { delete: jest.fn(), cache: { has: () => true } },
} as unknown as Guild;
let t: TestApp;
let svc: ChannelLifecycleService;
let bindings: ChannelBindingsService;
let seq = 0;

beforeAll(async () => {
  t = await getTestApp();
  svc = t.app.get(ChannelLifecycleService);
  bindings = t.app.get(ChannelBindingsService);
});

beforeEach(async () => {
  const client = t.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  jest.spyOn(client, 'getGuild').mockReturnValue(guild);
  jest.spyOn(ops, 'ensureCategory').mockImplementation((_g, o) =>
    Promise.resolve({
      id: o.name === 'Games' ? 'cat-games' : 'cat-arch',
      name: o.name,
      created: false,
    }),
  );
  jest
    .spyOn(ops, 'createTextChannel')
    .mockImplementation(() => Promise.resolve(`hub-ch-${++seq}`));
  jest.spyOn(ops, 'categorySeriesIds').mockImplementation(() => new Set());
  jest.spyOn(ops, 'categoryHasRoom').mockResolvedValue(true);
  jest.spyOn(ops, 'archiveChannel').mockResolvedValue({
    previousParentId: 'old-parent',
    restoreParentId: 'old-parent',
    added: ADDED,
  });
  await t.app.get(SettingsService).setChannelLifecycleSettings({
    enabled: true,
    maxChangesPerTick: 10,
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  t.seed = await truncateAllTables(t.db);
});

async function game(): Promise<number> {
  seq += 1;
  const [g] = nonEmpty(
    await t.db
      .insert(schema.games)
      .values({ name: `Hold Game ${seq}`, slug: `hold-${seq}-${Date.now()}` })
      .returning({ id: schema.games.id }),
    'game',
  );
  return g.id;
}

type HubState = 'active' | 'hidden' | 'archived';

/** An approved community hub, approved `days` ago, in `state`. */
async function hub(gameId: number, state: HubState, days = 0): Promise<number> {
  const row = await insertCommunityHub(t.db, {
    gameId,
    name: `Hold Hub ${(seq += 1)}`,
    blurb: '',
    status: 'active',
    proposedBy: t.seed.adminUser.id,
    reviewedBy: t.seed.adminUser.id,
  });
  const when = new Date(Date.now() - days * DAY);
  await t.db
    .update(schema.guilds)
    .set({
      createdAt: when,
      reviewedAt: when,
      ...(state === 'hidden' ? { hiddenAt: new Date() } : {}),
      ...(state === 'archived' ? { status: 'archived', archivedAt: when } : {}),
    })
    .where(eq(schema.guilds.id, row.id));
  return row.id;
}

/** A quiet, active auto-managed channel for the game (archive candidate). */
async function autoBinding(gameId: number): Promise<void> {
  const { binding } = await bindings.bind(
    GUILD,
    `pre-${gameId}`,
    'text',
    'game-announcements',
    gameId,
  );
  await t.db
    .update(schema.channelBindings)
    .set({ autoManaged: true, lifecycleState: 'active' })
    .where(eq(schema.channelBindings.id, binding.id));
}

const gameBindings = (gameId: number) =>
  t.db
    .select()
    .from(schema.channelBindings)
    .where(eq(schema.channelBindings.gameId, gameId));

const profileOf = async (hubId: number) =>
  (
    await t.db
      .select()
      .from(schema.guildProfiles)
      .where(eq(schema.guildProfiles.guildId, hubId))
  )[0];

describe('X2: an approved community hub creates its channel (ROK-1873)', () => {
  it('no managed channel → reconcile creates one and auto-links the hub', async () => {
    const id = await game();
    const hubId = await hub(id, 'active');
    await svc.reconcile(live);
    expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
    const rows = await gameBindings(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      autoManaged: true,
      lifecycleState: 'active',
    });
    expect(await profileOf(hubId)).toMatchObject({
      discordChannelId: rows[0]?.channelId,
      discordChannelSource: 'auto',
    });
  });

  it.each<[string, string | null]>([
    ['set', 'leader-picked-ch'],
    ['cleared', null],
  ])(
    'a hub whose Leader %s its channel (source=manual) is never auto-linked (§8c)',
    async (_label, channelId) => {
      const id = await game();
      const hubId = await hub(id, 'active');
      await t.db.insert(schema.guildProfiles).values({
        guildId: hubId,
        discordChannelId: channelId,
        discordChannelSource: 'manual',
      });
      await svc.reconcile(live);
      expect(ops.createTextChannel).toHaveBeenCalledTimes(1);
      expect(await profileOf(hubId)).toMatchObject({
        discordChannelId: channelId,
        discordChannelSource: 'manual',
      });
    },
  );

  it('a dormant (40 d quiet) hub alone never creates a channel', async () => {
    const id = await game();
    await hub(id, 'active', 40);
    await svc.reconcile(live);
    expect(ops.createTextChannel).not.toHaveBeenCalled();
    expect(await gameBindings(id)).toHaveLength(0);
  });
});

describe('D8: the hub hold keeps a quiet channel open (ROK-1873)', () => {
  it('an active, recently approved hub holds its game channel — no archive', async () => {
    const id = await game();
    await autoBinding(id);
    await hub(id, 'active');
    await svc.reconcile(live);
    expect(ops.archiveChannel).not.toHaveBeenCalled();
    expect((await gameBindings(id))[0]?.lifecycleState).toBe('active');
  });

  it.each<[string, HubState, number]>([
    ['dormant (quiet 40 d)', 'active', 40],
    ['hidden', 'hidden', 0],
    ['archived', 'archived', 0],
  ])(
    'a %s hub releases the hold → the quiet channel archives',
    async (_l, state, days) => {
      const id = await game();
      await autoBinding(id);
      await hub(id, state, days);
      await svc.reconcile(live);
      expect(ops.archiveChannel).toHaveBeenCalledTimes(1);
      expect((await gameBindings(id))[0]?.lifecycleState).toBe('archived');
    },
  );
});

/**
 * ROK-1871 (ROK-1428 §2.7, §2.11 R15–R17, D7) — real DB, FLEET-ONLY (needs
 * the Redis sidecar): hub auto-link writes the managed channel with
 * `source='auto'` only onto a channel-less hub; a Leader's set or clear
 * (`'manual'`) is never overwritten; the mirror DTO reports `channelSource`
 * and `managedFor`. `linkHubsForGame` is exactly what the reconcile's
 * create / link_hub executors call (`channel-lifecycle.apply.ts`); the full
 * reconcile path is covered by `channel-lifecycle.integration.spec.ts`.
 */
import { eq } from 'drizzle-orm';
import type { GuildDiscordChannelOptionDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { GuildDiscordService } from '../../guilds/guild-discord.service';
import type { GuildActor } from '../../guilds/guild-access.service';
import { ChannelMirrorService } from '../channel-mirror/channel-mirror.service';
import type { ChannelMirrorRead } from '../channel-mirror/channel-mirror.read';
import { HubChannelLinkService } from './hub-channel-link.service';

const MANAGED = '478810000000000001';
const LEADER_PICK = '478810000000000002';
const CHANNELS: GuildDiscordChannelOptionDto[] = [
  { id: MANAGED, name: 'valheim', visibility: 'public' },
  { id: LEADER_PICK, name: 'server-chat', visibility: 'public' },
];

let testApp: TestApp;
let linker: HubChannelLinkService;
let discord: GuildDiscordService;

type Kind = 'game_server' | 'wow_guild';

async function seedHub(kind: Kind = 'game_server', hidden = false) {
  const n = Math.floor(Math.random() * 1e9);
  const server = kind === 'game_server';
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind,
        region: 'us',
        name: `Hub ${n}`,
        nameKey: `hub ${n}`,
        source: server ? 'pelican' : 'addon_import',
        hiddenAt: hidden ? new Date() : null,
      })
      .returning(),
    'hub',
  );
  return hub.id;
}

async function profile(guildId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
  return row;
}

async function seedManagedBinding(): Promise<void> {
  await testApp.db.insert(schema.channelBindings).values({
    guildId: 'guild-1871',
    channelId: MANAGED,
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: testApp.seed.game.id,
    autoManaged: true,
  });
}

function admin(): GuildActor {
  return { id: testApp.seed.adminUser.id, role: 'admin' };
}

function okRead(id: string): ChannelMirrorRead {
  const channel = CHANNELS.find((c) => c.id === id);
  if (!channel) throw new Error(`unexpected channel ${id}`);
  return {
    state: 'ok',
    channel: { ...channel, url: `https://discord.com/channels/1/${id}` },
    messages: [],
    fetchedAt: '2026-10-20T12:00:00.000Z',
  };
}

beforeAll(async () => {
  testApp = await getTestApp();
  linker = new HubChannelLinkService(testApp.db);
  discord = testApp.app.get(GuildDiscordService);
});

beforeEach(() => {
  const mirror = testApp.app.get(ChannelMirrorService);
  jest
    .spyOn(mirror, 'listReadableTextChannels')
    .mockReturnValue({ connected: true, channels: CHANNELS });
  jest
    .spyOn(mirror, 'readLatest')
    .mockImplementation((id) => Promise.resolve(okRead(id)));
  jest.spyOn(mirror, 'clear').mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('R15 — a channel-less server hub is auto-linked', () => {
  it('no profile row → profile created with the channel + source auto', async () => {
    const hubId = await seedHub();
    await expect(
      linker.linkHubsForGame(testApp.seed.game.id, MANAGED),
    ).resolves.toBe(1);
    const row = await profile(hubId);
    expect(row?.discordChannelId).toBe(MANAGED);
    expect(row?.discordChannelSource).toBe('auto');
    expect(row?.discordChannelSetBy).toBeNull();
    expect(row?.discordChannelPrivateAck).toBe(false);
  });

  it('a profile row with a NULL channel is linked too', async () => {
    const hubId = await seedHub();
    await testApp.db.insert(schema.guildProfiles).values({ guildId: hubId });
    await linker.linkHubsForGame(testApp.seed.game.id, MANAGED);
    expect((await profile(hubId))?.discordChannelSource).toBe('auto');
  });

  it('feeds hubNeedsLink until linked', async () => {
    await seedHub();
    const gameId = testApp.seed.game.id;
    expect((await linker.hubNeedsLinkGameIds()).has(gameId)).toBe(true);
    await linker.linkHubsForGame(gameId, MANAGED);
    expect((await linker.hubNeedsLinkGameIds()).has(gameId)).toBe(false);
  });

  it('OQ-3: WoW guild hubs and hidden hubs are never linked', async () => {
    const wow = await seedHub('wow_guild');
    const hidden = await seedHub('game_server', true);
    await expect(
      linker.linkHubsForGame(testApp.seed.game.id, MANAGED),
    ).resolves.toBe(0);
    expect(await profile(wow)).toBeUndefined();
    expect(await profile(hidden)).toBeUndefined();
    expect(await linker.hubNeedsLinkGameIds()).toEqual(new Set());
  });
});

describe("R16 — a 'manual' hub is never touched", () => {
  it('a Leader-set channel stays', async () => {
    const hubId = await seedHub();
    await discord.setChannel(admin(), hubId, { channelId: LEADER_PICK });
    await expect(
      linker.linkHubsForGame(testApp.seed.game.id, MANAGED),
    ).resolves.toBe(0);
    const row = await profile(hubId);
    expect(row?.discordChannelId).toBe(LEADER_PICK);
    expect(row?.discordChannelSource).toBe('manual');
  });

  it('a Leader clear (NULL channel, manual) stays cleared', async () => {
    const hubId = await seedHub();
    await linker.linkHubsForGame(testApp.seed.game.id, MANAGED);
    await discord.clearChannel(hubId);
    await expect(
      linker.linkHubsForGame(testApp.seed.game.id, MANAGED),
    ).resolves.toBe(0);
    const row = await profile(hubId);
    expect(row?.discordChannelId).toBeNull();
    expect(row?.discordChannelSource).toBe('manual');
    expect(await linker.hubNeedsLinkGameIds()).toEqual(new Set());
  });
});

describe('R17 — a Leader PUT on an auto-linked hub flips it to manual', () => {
  it('auto-linked mirror reports channelSource auto + managedFor', async () => {
    await seedManagedBinding();
    const hubId = await seedHub();
    await linker.linkHubsForGame(testApp.seed.game.id, MANAGED);
    const read = await discord.getMirror(admin(), hubId);
    expect(read).toMatchObject({
      state: 'ok',
      channelSource: 'auto',
      managedFor: {
        gameId: testApp.seed.game.id,
        gameName: testApp.seed.game.name,
      },
    });
  });

  it("PUT → source 'manual'; mirror channelSource manual, managedFor null", async () => {
    await seedManagedBinding();
    const hubId = await seedHub();
    await linker.linkHubsForGame(testApp.seed.game.id, MANAGED);
    const read = await discord.setChannel(admin(), hubId, {
      channelId: LEADER_PICK,
    });
    expect(read).toMatchObject({ channelSource: 'manual', managedFor: null });
    expect((await profile(hubId))?.discordChannelSource).toBe('manual');
  });

  it('re-picking the managed channel by hand is still manual (managedFor kept)', async () => {
    await seedManagedBinding();
    const hubId = await seedHub();
    await linker.linkHubsForGame(testApp.seed.game.id, MANAGED);
    const read = await discord.setChannel(admin(), hubId, {
      channelId: MANAGED,
    });
    expect(read).toMatchObject({
      channelSource: 'manual',
      managedFor: { gameId: testApp.seed.game.id },
    });
  });
});

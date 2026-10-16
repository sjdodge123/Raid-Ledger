/**
 * ROK-1788 (S4) — guild Discord channel mirror endpoints against a real
 * database, with `ChannelMirrorService` (the only Discord-touching seam)
 * spied: the read/write permission matrix, every mirror state
 * (unset/ok/no-access/gone/disconnected), PUT validation (unreadable channel,
 * bot down), the private-channel acknowledgement + chooser check (staff
 * exempt), cache clears on rebind/unbind, and `set_by` ON DELETE SET NULL.
 * Booting `getTestApp()` also proves `ChannelMirrorModule` adds no DI cycle.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { GuildDiscordChannelOptionDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { loginAsAdmin } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import { ChannelMirrorService } from '../../../discord-bot/channel-mirror/channel-mirror.service';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import type { ChannelMirrorRead } from '../../../discord-bot/channel-mirror/channel-mirror.read';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  CHOOSER_CANNOT_VIEW_MESSAGE,
  LINK_DISCORD_MESSAGE,
  PRIVATE_ACK_MESSAGE,
  UNREADABLE_CHANNEL_MESSAGE,
} from './guild-discord.helpers';

const SNAP = new Date('2026-10-10T20:00:00.000Z');
const BASE = '/plugins/wow/guilds';
const PUBLIC: GuildDiscordChannelOptionDto = {
  id: '478800000000000001',
  name: 'announcements',
  visibility: 'public',
};
const PRIVATE: GuildDiscordChannelOptionDto = {
  id: '478800000000000002',
  name: 'officers',
  visibility: 'private',
};
const NO_ACCESS_ID = '478800000000000003';
const GONE_ID = '478800000000000004';
const UNREADABLE_ID = '478800000000000005';
const EDITOR_DISCORD_ID = '478800000000000099';

const OK_READ: ChannelMirrorRead = {
  state: 'ok',
  channel: { ...PUBLIC, url: `https://discord.com/channels/1/${PUBLIC.id}` },
  messages: [],
  fetchedAt: '2026-10-15T12:00:00.000Z',
};
const READS: Record<string, ChannelMirrorRead> = {
  [PUBLIC.id]: OK_READ,
  [PRIVATE.id]: { ...OK_READ, channel: { ...OK_READ.channel, ...PRIVATE } },
  [NO_ACCESS_ID]: {
    state: 'no-access',
    channelId: NO_ACCESS_ID,
    channelName: 'old-news',
  },
  [GONE_ID]: { state: 'gone', channelId: GONE_ID, channelName: null },
};

/** `editor` has a real Discord id; `local` is a granted editor without one. */
type Who = 'editor' | 'local' | 'plain' | 'outsider';
type Actor = Who | 'admin';

let testApp: TestApp;
let guildId: number;
let mirror: ChannelMirrorService;
const userIds = {} as Record<Who, number>;
const tokens = {} as Record<Actor, string>;
const fake = { connected: true, chooserCanView: false };

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function insertUser(who: Who): Promise<number> {
  const email = `${who}@guild-discord.test`;
  const discordId = who === 'editor' ? EDITOR_DISCORD_ID : `local:${email}`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username: `gdisc-${who}`, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
  return user.id;
}

/** A linked character + member row (unless outsider); editors get a grant. */
async function seedUser(who: Who): Promise<void> {
  const userId = await insertUser(who);
  userIds[who] = userId;
  if (who === 'outsider') return;
  const guid = `Player-1-gdisc-${who}`;
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: `gdisc${who}`,
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  const [member] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: `gdisc${who}`,
        rankIndex: 3,
        rankName: 'Rank 3',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  if (who === 'plain') return;
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId: member.id });
}

const call = (
  method: 'get' | 'put' | 'delete',
  path: string,
  who: Actor,
  body?: object,
) => {
  const req = testApp.request[method](`${BASE}/${guildId}${path}`).set(
    'Authorization',
    `Bearer ${tokens[who]}`,
  );
  return body ? req.send(body) : req;
};

async function bindDirect(
  channelId: string,
  setBy?: number,
  privateAck = false,
): Promise<void> {
  await testApp.db.insert(schema.guildProfiles).values({
    guildId,
    discordChannelId: channelId,
    discordChannelSetBy: setBy ?? null,
    discordChannelPrivateAck: privateAck,
  });
}

async function profileRow() {
  const [row] = await testApp.db
    .select()
    .from(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
  return row;
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  mirror = testApp.app.get(ChannelMirrorService);
  guildId = await insertGuild('Discord Mirror Keepers');
  for (const who of ['editor', 'local', 'plain', 'outsider'] as const) {
    await seedUser(who);
  }
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

/** Randomized order: every test starts unbound with a connected fake bot. */
beforeEach(async () => {
  await testApp.db
    .delete(schema.guildProfiles)
    .where(eq(schema.guildProfiles.guildId, guildId));
  fake.connected = true;
  fake.chooserCanView = false;
  jest
    .spyOn(mirror, 'listReadableTextChannels')
    .mockImplementation(() =>
      fake.connected
        ? { connected: true, channels: [PUBLIC, PRIVATE] }
        : { connected: false, channels: [] },
    );
  jest
    .spyOn(mirror, 'canDiscordUserView')
    .mockImplementation(() => Promise.resolve(fake.chooserCanView));
  jest
    .spyOn(mirror, 'readLatest')
    .mockImplementation((id) =>
      Promise.resolve(READS[id] ?? { state: 'disconnected', channelId: id }),
    );
  jest.spyOn(mirror, 'clear').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('permission matrix', () => {
  it.each([
    ['admin', 200],
    ['editor', 200],
    ['plain', 200],
    ['outsider', 403],
  ] as const)('GET mirror: %s → %i', async (who, status) => {
    expect((await call('get', '/discord', who)).status).toBe(status);
  });

  it.each(['plain', 'outsider'] as const)(
    'channel list + writes: %s → 403',
    async (who) => {
      const results = await Promise.all([
        call('get', '/discord/channels', who),
        call('put', '/discord/channel', who, { channelId: PUBLIC.id }),
        call('delete', '/discord/channel', who),
      ]);
      expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
      expect(await profileRow()).toBeUndefined();
    },
  );

  it('GET on an unknown guild is 404 for staff', async () => {
    const res = await testApp.request
      .get(`${BASE}/999999/discord`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(res.status).toBe(404);
  });
});

describe('GET mirror states', () => {
  it('unset when nothing is bound — Discord is never asked', async () => {
    const res = await call('get', '/discord', 'plain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'unset' });
    expect(mirror.readLatest).not.toHaveBeenCalled();
  });

  it.each([
    ['ok', PUBLIC.id],
    ['no-access', NO_ACCESS_ID],
    ['gone', GONE_ID],
  ] as const)('bound → %s, passed through', async (state, channelId) => {
    await bindDirect(channelId);
    const res = await call('get', '/discord', 'plain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(READS[channelId]);
    expect(res.body.state).toBe(state);
    expect(mirror.readLatest).toHaveBeenCalledWith(channelId);
  });

  it('bot down → disconnected in-card state, not an error', async () => {
    await bindDirect(UNREADABLE_ID);
    const res = await call('get', '/discord', 'plain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      state: 'disconnected',
      channelId: UNREADABLE_ID,
    });
  });
});

describe('private channel without an ack on record (review MINOR 3)', () => {
  it('bound while public, now private → no-access with the name withheld', async () => {
    await bindDirect(PRIVATE.id);
    const res = await call('get', '/discord', 'plain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      state: 'no-access',
      channelId: PRIVATE.id,
      channelName: null,
    });
  });

  it('private with the ack on record → ok', async () => {
    await bindDirect(PRIVATE.id, undefined, true);
    const res = await call('get', '/discord', 'plain');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(READS[PRIVATE.id]);
  });
});

describe('server name (review MINOR 5)', () => {
  beforeEach(() => {
    jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'getGuildInfo')
      .mockReturnValue({ name: 'Keepers HQ', memberCount: 12 });
  });

  it('the ok read names the bot\'s server', async () => {
    await bindDirect(PUBLIC.id);
    const res = await call('get', '/discord', 'plain');
    expect(res.body).toEqual({
      ...OK_READ,
      channel: { ...OK_READ.channel, serverName: 'Keepers HQ' },
    });
  });

  it('the channel list names the bot\'s server', async () => {
    const res = await call('get', '/discord/channels', 'editor');
    expect(res.body).toEqual({
      connected: true,
      channels: [PUBLIC, PRIVATE],
      serverName: 'Keepers HQ',
    });
  });
});

describe('channel list', () => {
  it('editor sees the bot-readable channels', async () => {
    const res = await call('get', '/discord/channels', 'editor');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, channels: [PUBLIC, PRIVATE] });
  });

  it('bot down → connected:false + [], never a 5xx', async () => {
    fake.connected = false;
    const res = await call('get', '/discord/channels', 'editor');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, channels: [] });
  });
});

describe('PUT public channel', () => {
  it('editor binds; row stamped; cache cleared; mirror returned', async () => {
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: PUBLIC.id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(OK_READ);
    const row = await profileRow();
    expect(row?.discordChannelId).toBe(PUBLIC.id);
    expect(row?.discordChannelPrivateAck).toBe(false);
    expect(row?.discordChannelSetBy).toBe(userIds.editor);
    expect(row?.discordChannelSetAt).toBeInstanceOf(Date);
    expect(mirror.clear).toHaveBeenCalledWith(PUBLIC.id);
  });

  it('rebind clears the cache for the old AND the new channel', async () => {
    await bindDirect(GONE_ID);
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: PUBLIC.id,
    });
    expect(res.status).toBe(200);
    expect(mirror.clear).toHaveBeenCalledWith(GONE_ID);
    expect(mirror.clear).toHaveBeenCalledWith(PUBLIC.id);
    expect((await profileRow())?.discordChannelId).toBe(PUBLIC.id);
  });
});

describe('PUT validation', () => {
  it('a channel the bot cannot read → 400, nothing stored', async () => {
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: UNREADABLE_ID,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(UNREADABLE_CHANNEL_MESSAGE);
    expect(await profileRow()).toBeUndefined();
  });

  it.each([
    [{ channelId: 'general' }],
    [{ channelId: PUBLIC.id, extra: true }],
    [{}],
  ])('malformed body %j → 400', async (body) => {
    expect((await call('put', '/discord/channel', 'editor', body)).status).toBe(
      400,
    );
  });

  it('bot down → 409, nothing stored', async () => {
    fake.connected = false;
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: PUBLIC.id,
    });
    expect(res.status).toBe(409);
    expect(await profileRow()).toBeUndefined();
  });
});

describe('PUT private channel (D7)', () => {
  it('without the acknowledgement → 400', async () => {
    fake.chooserCanView = true;
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: PRIVATE.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(PRIVATE_ACK_MESSAGE);
    expect(await profileRow()).toBeUndefined();
  });

  it("acked, but the chooser's Discord account can't see it → 403", async () => {
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: PRIVATE.id,
      privateAck: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(CHOOSER_CANNOT_VIEW_MESSAGE);
    expect(mirror.canDiscordUserView).toHaveBeenCalledWith(
      EDITOR_DISCORD_ID,
      PRIVATE.id,
    );
    expect(await profileRow()).toBeUndefined();
  });

  it('acked + chooser can see it → 200, ack stored', async () => {
    fake.chooserCanView = true;
    const res = await call('put', '/discord/channel', 'editor', {
      channelId: PRIVATE.id,
      privateAck: true,
    });
    expect(res.status).toBe(200);
    expect((await profileRow())?.discordChannelPrivateAck).toBe(true);
  });

  it('editor without a linked Discord account → 400', async () => {
    fake.chooserCanView = true;
    const res = await call('put', '/discord/channel', 'local', {
      channelId: PRIVATE.id,
      privateAck: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(LINK_DISCORD_MESSAGE);
    expect(mirror.canDiscordUserView).not.toHaveBeenCalled();
  });

  it('staff are exempt from the chooser check (ack still required)', async () => {
    const res = await call('put', '/discord/channel', 'admin', {
      channelId: PRIVATE.id,
      privateAck: true,
    });
    expect(res.status).toBe(200);
    expect(mirror.canDiscordUserView).not.toHaveBeenCalled();
    expect((await profileRow())?.discordChannelPrivateAck).toBe(true);
  });
});

describe('DELETE + set_by', () => {
  it('editor unbinds → 204, columns reset, old cache cleared, GET unset', async () => {
    await bindDirect(PUBLIC.id, userIds.editor);
    const res = await call('delete', '/discord/channel', 'editor');
    expect(res.status).toBe(204);
    const row = await profileRow();
    expect(row?.discordChannelId).toBeNull();
    expect(row?.discordChannelSetBy).toBeNull();
    expect(row?.discordChannelPrivateAck).toBe(false);
    expect(mirror.clear).toHaveBeenCalledWith(PUBLIC.id);
    expect((await call('get', '/discord', 'plain')).body).toEqual({
      state: 'unset',
    });
  });

  it('deleting the user who set the channel nulls set_by (FK SET NULL)', async () => {
    const [temp] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: 'local:gdisc-temp', username: 'gdisc-temp' })
        .returning(),
      'temp user',
    );
    await bindDirect(PUBLIC.id, temp.id);
    await testApp.db.delete(schema.users).where(eq(schema.users.id, temp.id));
    const row = await profileRow();
    expect(row?.discordChannelId).toBe(PUBLIC.id);
    expect(row?.discordChannelSetBy).toBeNull();
  });
});

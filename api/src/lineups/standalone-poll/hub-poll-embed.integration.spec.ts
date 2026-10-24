/**
 * ROK-1896 — a hub-tied poll's Discord surfaces name their hub and link to it,
 * against a real database.
 *
 * Card: the scheduling-poll embed service, the embed factory and the hub
 * resolver run for real; Discord is mocked like
 * `embed-hub-link.integration.spec.ts` (spy `sendEmbed` / `editEmbed`, the
 * channel resolver and the client URL). Two visible community hubs on the
 * game make the GAME rule pick the `/hubs?game=` directory, so a single
 * `/hubs/<tiedId>` link proves the explicit tie wins.
 *
 * NOTE: since ROK-1893 P3 (ruling 2026-10-23) creating a hub poll posts no
 * default-channel card, so the card is posted here by calling
 * `firePostInitialEmbed` directly — the path every card takes — and
 * re-rendered through `syncEmbed` (the vote / lock / sweep path).
 *
 * DMs: the stored `notifications` rows (picked-member poll DM + the deadline
 * reminder) carry `hubId` / `hubName` only while the tied hub is visible.
 * Fleet-only (needs Redis).
 */
import { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { insertCommunityHub } from '../../guilds/community/community-proposals.queries';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../../discord-bot/services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import { NotificationService } from '../../notifications/notification.service';
import { StandalonePollReminderService } from './standalone-poll-reminder.service';

const BASE = 'https://raid.example.com';
const HOUR_MS = 3_600_000;
let testApp: TestApp;
let adminToken: string;
let seq = 0;
let sendEmbed: jest.SpyInstance;
let editEmbed: jest.SpyInstance;
let createNotif: jest.SpyInstance;

interface Hub {
  id: number;
  name: string;
}
interface Poll {
  matchId: number;
  lineupId: number;
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'isConnected').mockReturnValue(true);
  sendEmbed = jest
    .spyOn(client, 'sendEmbed')
    .mockResolvedValue({ id: 'msg-1896' } as never);
  editEmbed = jest
    .spyOn(client, 'editEmbed')
    .mockResolvedValue(undefined as never);
  const resolver = testApp.app.get(ChannelResolverService);
  jest.spyOn(resolver, 'resolveChannelForEvent').mockResolvedValue('chan-1896');
  const settings = testApp.app.get(SettingsService);
  jest.spyOn(settings, 'getClientUrl').mockResolvedValue(BASE);
  // The DM write is stubbed; the payload handed to it is what is asserted.
  createNotif = jest
    .spyOn(testApp.app.get(NotificationService), 'create')
    .mockResolvedValue(null);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

/** An active community hub on the seed game. */
async function mkHub(label: string): Promise<Hub> {
  const name = `${label} ${++seq}`;
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name,
    blurb: 'Hub poll embed',
    status: 'active',
    proposedBy: testApp.seed.adminUser.id,
    reviewedBy: testApp.seed.adminUser.id,
  });
  return { id: hub.id, name };
}

async function hideHub(id: number): Promise<void> {
  await testApp.db
    .update(schema.guilds)
    .set({ hiddenAt: new Date() })
    .where(eq(schema.guilds.id, id));
}

async function mkUser(): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username: `hpe-${++seq}-${Date.now() % 1e5}`, role: 'member' })
      .returning(),
    'user',
  );
  return user.id;
}

async function createPoll(body: Record<string, unknown>): Promise<Poll> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id, ...body });
  expect(res.status).toBe(201);
  const b = res.body as { id: number; lineupId: number };
  return { matchId: b.id, lineupId: b.lineupId };
}

/** Poll until `check` is non-null, or fail naming `label`. */
async function pollUntil<T>(
  check: () => Promise<T | null> | T | null,
  label: string,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const value = await check();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** The description of a captured EmbedBuilder argument. */
function descOf(embed: unknown): string {
  return embed instanceof EmbedBuilder ? (embed.data.description ?? '') : '';
}

/** Post the card and wait for the post-send refresh (ROK-1554) to land. */
async function postCard(poll: Poll): Promise<string> {
  const embed = testApp.app.get(SchedulingPollEmbedService);
  embed.firePostInitialEmbed(
    { id: poll.matchId, gameId: testApp.seed.game.id },
    poll.lineupId,
    testApp.seed.game.id,
  );
  await pollUntil(
    () => (editEmbed.mock.calls.length > 0 ? true : null),
    'the post-send card refresh',
  );
  return descOf(sendEmbed.mock.calls[0]?.[1]);
}

/** Re-render the card (vote / lock / sweep path); the edited description. */
async function rerender(matchId: number): Promise<string> {
  editEmbed.mockClear();
  await testApp.app.get(SchedulingPollEmbedService).syncEmbed(matchId);
  return descOf(editEmbed.mock.calls[0]?.[2]);
}

/** Every hub URL in a description (`/hubs/<id>` or the `/hubs?game=` list). */
function hubLinks(desc: string): string[] {
  return [...desc.matchAll(/\/hubs(?:\/\d+|\?game=\d+)/g)].map((m) => m[0]);
}

function expectNamesAndLinksHub(desc: string, hub: Hub): void {
  expect(desc.split('\n')[0]).toBe(`Hub: **${hub.name}**`);
  expect(desc.split(`Hub: **${hub.name}**`)).toHaveLength(2);
  expect(hubLinks(desc)).toEqual([`/hubs/${hub.id}`]);
}

async function addYesVote(matchId: number, userId: number): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + 864e5),
        suggestedBy: 'user',
      })
      .returning(),
    'slot',
  );
  await testApp.db
    .insert(schema.communityLineupScheduleVotes)
    .values({ slotId: slot.id, userId, stance: 'yes' });
}

describe('hub poll channel card (ROK-1896)', () => {
  it('a reschedule poll from a hub event names + links that hub', async () => {
    const tied = await mkHub('Crew A');
    await mkHub('Crew B');
    const start = new Date(Date.now() + 2 * 864e5);
    const [event] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: 'Hub night 1896',
          gameId: testApp.seed.game.id,
          creatorId: testApp.seed.adminUser.id,
          duration: [start, new Date(start.getTime() + 72e5)],
          guildId: tied.id,
        })
        .returning(),
      'event',
    );
    const poll = await createPoll({ linkedEventId: event.id });
    expectNamesAndLinksHub(await postCard(poll), tied);
  });

  it('a hub poll names + links its hub, and a vote re-render keeps it', async () => {
    const tied = await mkHub('Crew A');
    await mkHub('Crew B');
    const poll = await createPoll({ hubId: tied.id });
    expectNamesAndLinksHub(await postCard(poll), tied);
    await addYesVote(poll.matchId, testApp.seed.adminUser.id);
    expectNamesAndLinksHub(await rerender(poll.matchId), tied);
  });

  it('a hidden tied hub: no name line, link falls back to the game rule (D9)', async () => {
    const tied = await mkHub('Crew A');
    const other = await mkHub('Crew B');
    const poll = await createPoll({ hubId: tied.id });
    await postCard(poll);
    await hideHub(tied.id);
    const desc = await rerender(poll.matchId);
    expect(desc).not.toContain('Hub: **');
    expect(desc).not.toContain(tied.name);
    expect(hubLinks(desc)).toEqual([`/hubs/${other.id}`]);
  });
});

/** The `community_lineup` payload of `subtype` handed to `create` for a user. */
async function payloadFor(
  userId: number,
  subtype: string,
): Promise<Record<string, unknown>> {
  return pollUntil(() => {
    for (const call of createNotif.mock.calls) {
      const arg = call[0] as {
        userId?: number;
        type?: string;
        payload?: Record<string, unknown>;
      };
      if (arg.userId !== userId || arg.type !== 'community_lineup') continue;
      if (arg.payload?.subtype === subtype) return arg.payload;
    }
    return null;
  }, `${subtype} notification for user ${userId}`);
}

/** Put the poll's deadline `ms` from now (inside a reminder window). */
async function setDeadline(lineupId: number, ms: number): Promise<void> {
  await testApp.db
    .update(schema.communityLineups)
    .set({ phaseDeadline: new Date(Date.now() + ms) })
    .where(eq(schema.communityLineups.id, lineupId));
}

describe('hub poll DM payloads (ROK-1896)', () => {
  it('the picked-member poll DM carries hubId + hubName; untagged has neither', async () => {
    const tied = await mkHub('Crew A');
    const member = await mkUser();
    await createPoll({ hubId: tied.id, memberUserIds: [member] });
    const hubbed = await payloadFor(member, 'standalone_scheduling_poll');
    expect(hubbed).toEqual(
      expect.objectContaining({ hubId: tied.id, hubName: tied.name }),
    );
    const plainMember = await mkUser();
    await createPoll({ visibility: 'private', memberUserIds: [plainMember] });
    const plain = await payloadFor(plainMember, 'standalone_scheduling_poll');
    expect(plain).not.toHaveProperty('hubId');
    expect(plain).not.toHaveProperty('hubName');
  });

  it('the deadline reminder carries the visible hub, and drops it once hidden', async () => {
    const tied = await mkHub('Crew A');
    const member = await mkUser();
    const poll = await createPoll({ hubId: tied.id, memberUserIds: [member] });
    const reminders = testApp.app.get(StandalonePollReminderService);
    const subtype = 'standalone_scheduling_poll_reminder';
    await setDeadline(poll.lineupId, 12 * HOUR_MS); // 24h window
    await reminders.runReminders();
    expect(await payloadFor(member, subtype)).toEqual(
      expect.objectContaining({
        window: '24h',
        hubId: tied.id,
        hubName: tied.name,
      }),
    );
    createNotif.mockClear();
    await hideHub(tied.id);
    await setDeadline(poll.lineupId, HOUR_MS / 2); // 1h window, fresh dedup key
    await reminders.runReminders();
    const hidden = await payloadFor(member, subtype);
    expect(hidden.window).toBe('1h');
    expect(hidden).not.toHaveProperty('hubId');
    expect(hidden).not.toHaveProperty('hubName');
  });
});

/**
 * ROK-1768 — `/bind purpose:` drives the REAL BindCommand handler against a
 * real Postgres (bots cannot press another bot's slash command, so this is the
 * tier that proves the Discord path writes what the admin form writes).
 *
 * Covers: a Quick Play bind writes the same row as the admin POST and titles
 * the reply with the game; the one-per-game 409 names the channel that already
 * posts; QP without a game / on voice / with a series is refused with no row;
 * no purpose keeps the old game-announcements default; a member is refused
 * (ROK-1628).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ChannelType } from 'discord.js';
import { quickPlayGameTakenMessage } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { FakeInteraction } from '../../admin/fake-interaction';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { BindCommand } from './bind.command';
import { QP_WITH_SERIES_ERROR } from './bind.purpose';

const GUILD = 'rok1768-guild';
const CH_A = 'rok1768-text-a';
const CH_B = 'rok1768-text-b';
const CH_SERIES = 'rok1768-series-text';
const VOICE = 'rok1768-voice';
const OPERATOR_DISCORD = 'rok1768-operator';
const MEMBER_DISCORD = 'rok1768-member';
const QP = 'quick-play-announcements';
const TEXT = ChannelType.GuildText;

let testApp: TestApp;
let token: string;
let valheimId: number;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD);
  token = await loginAsAdmin(testApp.request, testApp.seed);
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: 'rok1768-valheim' })
      .returning(),
    'valheim',
  );
  valheimId = game.id;
  await testApp.db.insert(schema.users).values([
    { discordId: OPERATOR_DISCORD, username: 'rok1768-op', role: 'operator' },
    { discordId: MEMBER_DISCORD, username: 'rok1768-member', role: 'member' },
  ]);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

const cb = schema.channelBindings;

/** Run `/bind` through the real handler and return the captured reply. */
async function runBind(o: {
  channel: { id: string; type: ChannelType };
  game?: string;
  purpose?: string;
  series?: string;
  caller?: string;
}) {
  const interaction = new FakeInteraction({
    commandName: 'bind',
    guildId: GUILD,
    discordUserId: o.caller ?? OPERATOR_DISCORD,
    options: {
      channel: o.channel,
      ...(o.game !== undefined && { game: o.game }),
      ...(o.purpose !== undefined && { purpose: o.purpose }),
      ...(o.series !== undefined && { series: o.series }),
    },
  });
  await testApp.app
    .get(BindCommand, { strict: false })
    .handleInteraction(interaction as never);
  return interaction.toResponse();
}

const rowsOn = (channelId: string) =>
  testApp.db.select().from(cb).where(eq(cb.channelId, channelId));

const qpRows = () =>
  testApp.db.select().from(cb).where(eq(cb.bindingPurpose, QP));

/** The columns the admin form and `/bind` must agree on. */
function shape(row: typeof cb.$inferSelect) {
  const { guildId, channelId, channelType, bindingPurpose, gameId } = row;
  return {
    guildId,
    channelId,
    channelType,
    bindingPurpose,
    gameId,
    recurrenceGroupId: row.recurrenceGroupId,
    config: row.config,
  };
}

/** A weekly Valheim series with its text announce binding on CH_SERIES. */
async function seedSeriesTextBinding() {
  const seriesId = randomUUID();
  const now = Date.now();
  await testApp.db.insert(schema.events).values({
    title: 'ROK-1768 weekly',
    creatorId: testApp.seed.adminUser.id,
    duration: [new Date(now + 86_400_000), new Date(now + 90_000_000)] as [
      Date,
      Date,
    ],
    gameId: valheimId,
    recurrenceGroupId: seriesId,
  });
  const [seriesBinding] = nonEmpty(
    await testApp.db
      .insert(cb)
      .values({
        guildId: GUILD,
        channelId: CH_SERIES,
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: valheimId,
        recurrenceGroupId: seriesId,
        config: {},
      })
      .returning(),
    'series binding',
  );
  return { seriesId, seriesBinding };
}

describe('/bind purpose: Quick Play Announcements (ROK-1768)', () => {
  it('QP + text + game writes the same row as the admin POST and titles the reply with the game', async () => {
    const res = await runBind({
      channel: { id: CH_A, type: TEXT },
      game: 'Valheim',
      purpose: QP,
    });

    expect(res.embeds?.[0]?.title).toBe(
      `#channel-${CH_A} → Quick Play Announcements · Valheim`,
    );
    const [fromDiscord] = nonEmpty(await rowsOn(CH_A), 'discord QP row');
    expect(await rowsOn(CH_A)).toHaveLength(1);
    expect(shape(fromDiscord)).toMatchObject({
      guildId: GUILD,
      channelType: 'text',
      bindingPurpose: QP,
      gameId: valheimId,
      recurrenceGroupId: null,
    });

    await testApp.db.delete(cb).where(eq(cb.id, fromDiscord.id));
    const post = await testApp.request
      .post('/admin/discord/bindings')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        channelId: CH_A,
        channelType: 'text',
        bindingPurpose: QP,
        gameId: valheimId,
      });
    expect(post.status).toBe(201);
    const [fromAdmin] = nonEmpty(await rowsOn(CH_A), 'admin QP row');
    expect(shape(fromDiscord)).toEqual(shape(fromAdmin));
  });

  it('a second QP for the same game on another channel names the channel that already posts', async () => {
    await runBind({
      channel: { id: CH_A, type: TEXT },
      game: 'Valheim',
      purpose: QP,
    });

    const res = await runBind({
      channel: { id: CH_B, type: TEXT },
      game: 'Valheim',
      purpose: QP,
    });

    expect(res.content).toBe(quickPlayGameTakenMessage(`<#${CH_A}>`));
    const rows = await qpRows();
    expect(rows.map((r) => r.channelId)).toEqual([CH_A]);
  });
});

describe('/bind purpose: refusals write nothing (ROK-1768)', () => {
  it('QP without a game is refused with the classifier sentence and writes nothing', async () => {
    const res = await runBind({
      channel: { id: CH_A, type: TEXT },
      purpose: QP,
    });

    expect(res.content).toBe(
      'A Quick Play Announcements binding must have a game.',
    );
    expect(await rowsOn(CH_A)).toHaveLength(0);
  });

  it('QP on a voice channel is refused as the wrong channel type and writes nothing', async () => {
    const res = await runBind({
      channel: { id: VOICE, type: ChannelType.GuildVoice },
      game: 'Valheim',
      purpose: QP,
    });

    expect(res.content).toContain(
      "A voice channel cannot use the 'quick-play-announcements' purpose.",
    );
    expect(await rowsOn(VOICE)).toHaveLength(0);
  });

  it('QP with a series is refused, writes nothing, and the series text binding survives', async () => {
    const { seriesId, seriesBinding } = await seedSeriesTextBinding();

    const res = await runBind({
      channel: { id: CH_B, type: TEXT },
      series: seriesId,
      purpose: QP,
    });

    expect(res.content).toBe(QP_WITH_SERIES_ERROR);
    expect(await qpRows()).toHaveLength(0);
    expect(await rowsOn(CH_B)).toHaveLength(0);
    const survivors = await testApp.db
      .select()
      .from(cb)
      .where(and(eq(cb.id, seriesBinding.id), eq(cb.channelId, CH_SERIES)));
    expect(survivors).toHaveLength(1);
  });
});

describe('/bind without purpose and as a member (ROK-1768)', () => {
  it('no purpose keeps the game-announcements default', async () => {
    await runBind({ channel: { id: CH_A, type: TEXT }, game: 'Valheim' });

    const rows = await rowsOn(CH_A);
    expect(rows.map((r) => [r.bindingPurpose, r.gameId])).toEqual([
      ['game-announcements', valheimId],
    ]);
  });

  it('a member caller is refused before anything is written (ROK-1628)', async () => {
    const res = await runBind({
      channel: { id: CH_A, type: TEXT },
      game: 'Valheim',
      purpose: QP,
      caller: MEMBER_DISCORD,
    });

    expect(res.content).toBe(
      'Changing channel bindings needs operator/admin permissions.',
    );
    expect(await rowsOn(CH_A)).toHaveLength(0);
  });
});

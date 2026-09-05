/**
 * ROK-1471 D3a — the `lfg-board` binding lookup, against real Postgres.
 *
 * `findLfgBoardBindingChannelId` is the operator's manual override: the bot
 * creates and owns the forum by default, and an operator who wants a different
 * one binds it by hand. The query is one `where` with two predicates, which is
 * exactly the kind of thing a unit test with a mocked builder cannot prove —
 * a dropped `guildId` clause or a mistyped purpose string still "passes" a
 * fake. So this runs against the real table, with real rows.
 *
 * `binding_purpose` is a plain varchar (no enum), so `lfg-board` needs no
 * migration; the partial unique index on (guild, channel, purpose) for
 * null-game non-series rows is why each case below uses distinct channels.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { LFG_BOARD_BINDING_PURPOSE } from './lfg-board.constants';
import { findLfgBoardBindingChannelId } from './lfg-board-channel.db-helpers';

const GUILD = 'rok1471-guild';
const OTHER_GUILD = 'rok1471-other-guild';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Raw-insert a non-series, game-less binding. */
async function insertBinding(o: {
  guildId: string;
  channelId: string;
  bindingPurpose: string;
  channelType?: string;
}): Promise<void> {
  await testApp.db.insert(schema.channelBindings).values({
    guildId: o.guildId,
    channelId: o.channelId,
    channelType: o.channelType ?? 'forum',
    bindingPurpose: o.bindingPurpose,
    gameId: null,
    recurrenceGroupId: null,
    config: {},
  });
}

describe('findLfgBoardBindingChannelId (ROK-1471 A4, integration)', () => {
  it('returns the channel id of the guild lfg-board binding', async () => {
    await insertBinding({
      guildId: GUILD,
      channelId: 'forum-override',
      bindingPurpose: LFG_BOARD_BINDING_PURPOSE,
    });

    await expect(findLfgBoardBindingChannelId(testApp.db, GUILD)).resolves.toBe(
      'forum-override',
    );
  });

  it('returns null when the guild has no bindings at all', async () => {
    await expect(
      findLfgBoardBindingChannelId(testApp.db, GUILD),
    ).resolves.toBeNull();
  });

  it('returns null when the guild has only other-purpose bindings', async () => {
    await insertBinding({
      guildId: GUILD,
      channelId: 'announce-channel',
      bindingPurpose: 'game-announcements',
      channelType: 'text',
    });
    await insertBinding({
      guildId: GUILD,
      channelId: 'lobby-channel',
      bindingPurpose: 'general-lobby',
      channelType: 'voice',
    });

    await expect(
      findLfgBoardBindingChannelId(testApp.db, GUILD),
    ).resolves.toBeNull();
  });

  it('ignores an lfg-board binding that belongs to another guild', async () => {
    await insertBinding({
      guildId: OTHER_GUILD,
      channelId: 'someone-elses-forum',
      bindingPurpose: LFG_BOARD_BINDING_PURPOSE,
    });

    await expect(
      findLfgBoardBindingChannelId(testApp.db, GUILD),
    ).resolves.toBeNull();
    await expect(
      findLfgBoardBindingChannelId(testApp.db, OTHER_GUILD),
    ).resolves.toBe('someone-elses-forum');
  });

  it('does not confuse the board binding with a same-channel binding of another purpose', async () => {
    await insertBinding({
      guildId: GUILD,
      channelId: 'shared-channel',
      bindingPurpose: 'game-announcements',
      channelType: 'text',
    });
    await insertBinding({
      guildId: GUILD,
      channelId: 'shared-channel',
      bindingPurpose: LFG_BOARD_BINDING_PURPOSE,
    });

    await expect(findLfgBoardBindingChannelId(testApp.db, GUILD)).resolves.toBe(
      'shared-channel',
    );
  });
});

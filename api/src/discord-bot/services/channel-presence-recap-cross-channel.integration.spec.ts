/**
 * ROK-1888 OQ3 (ruling: the recap covers everyone across all channels).
 *
 * One live Quick Play per game (ruling 3) means a session born on channel A
 * is fed by channel B's members too. B's presence-card recap must list that
 * session, and the session's roster must name the people from BOTH channels.
 * B's message knows who sat in it through the occupancy ledger (ROK-1499), so
 * a session counts as B's when any of B's occupants is one of its
 * participants.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { createAdHocEventRow } from './ad-hoc-event.helpers';
import type { AdHocNotificationDeps } from './ad-hoc-notification.helpers';
import { ChannelBindingsService } from './channel-bindings.service';
import { hydrateRecap } from './channel-presence-flush.helpers';
import { recapEvents } from './channel-presence-room.helpers';
import { ChannelResolverService } from './channel-resolver.service';

const GUILD_ID = 'rok1888-oq3-guild';
const CHANNEL_A = 'rok1888-oq3-voice-a';
const CHANNEL_B = 'rok1888-oq3-voice-b';

let testApp: TestApp;
let deps: AdHocNotificationDeps;

async function seedBinding(channelId: string): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({
        guildId: GUILD_ID,
        channelId,
        channelType: 'voice',
        bindingPurpose: 'general-lobby',
        gameId: null,
        config: { minPlayers: 2 },
      })
      .returning({ id: schema.channelBindings.id }),
    channelId,
  );
  return row.id;
}

async function voiceRow(eventId: number, id: string, name: string) {
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId,
    discordUserId: id,
    discordUsername: name,
  });
}

/** B's presence message, with `occupants` recorded in its ledger. */
async function presenceRow(
  bindingId: string,
  openedAt: Date,
  occupants: string[],
): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.discordChannelPresenceMessages)
      .values({
        guildId: GUILD_ID,
        voiceChannelId: CHANNEL_B,
        bindingId,
        textChannelId: 'rok1888-oq3-text',
        messageId: `rok1888-oq3-msg-${String(occupants.length)}`,
        openedAt,
      })
      .returning({ id: schema.discordChannelPresenceMessages.id }),
    'presence row',
  );
  for (const id of occupants) {
    await testApp.db.insert(schema.discordChannelPresenceOccupancy).values({
      presenceMessageId: row.id,
      discordUserId: id,
      displayName: id,
    });
  }
  return row.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
  deps = {
    db: testApp.db,
    channelBindingsService: testApp.app.get(ChannelBindingsService),
    channelResolver: testApp.app.get(ChannelResolverService),
    settingsService: testApp.app.get(SettingsService),
  };
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-1888 OQ3 — the recap covers a session fed from two channels', () => {
  const opened = new Date(Date.now() - 60_000);

  async function seedSharedSession() {
    const bindingA = await seedBinding(CHANNEL_A);
    const bindingB = await seedBinding(CHANNEL_B);
    const eventId = await createAdHocEventRow(
      testApp.db,
      bindingA,
      { gameId: null },
      testApp.seed.adminUser.id,
    );
    await voiceRow(eventId, 'oq3-alpha', 'Alpha');
    await voiceRow(eventId, 'oq3-bravo', 'Bravo');
    return { bindingB, eventId };
  }

  it("channel B's recap lists the A-born session one of its occupants joined", async () => {
    const { bindingB, eventId } = await seedSharedSession();
    const rowB = await presenceRow(bindingB, opened, ['oq3-bravo']);

    const recap = await recapEvents(testApp.db, bindingB, opened, rowB);
    expect(recap.map((e) => e.id)).toEqual([eventId]);
  });

  it('the hydrated recap names the participants from BOTH channels', async () => {
    const { bindingB } = await seedSharedSession();
    const rowB = await presenceRow(bindingB, opened, ['oq3-bravo']);

    const sessions = await hydrateRecap(deps, bindingB, {
      openedAt: opened,
      id: rowB,
    });
    const names = sessions.map((s) =>
      (s.signupMentions ?? []).map((m) => m.username).sort(),
    );
    expect(names).toEqual([['Alpha', 'Bravo']]);
  });

  it('M1: the recap labels an unlinked server row and never counts or names an anonymous one', async () => {
    const { bindingB, eventId } = await seedSharedSession();
    const steamRow = (steamId: string, name: string) => ({
      eventId,
      discordUserId: null,
      discordUsername: name,
      userId: null,
      steamId,
      onServer: true,
      inVoice: false,
    });
    await testApp.db
      .insert(schema.adHocParticipants)
      .values([
        steamRow('76561198000001888', 'Loanati'),
        steamRow('76561198000002888', '76561198000002888'),
      ]);
    const rowB = await presenceRow(bindingB, opened, ['oq3-bravo']);

    const [session] = await hydrateRecap(deps, bindingB, {
      openedAt: opened,
      id: rowB,
    });
    expect(session?.signupCount).toBe(2);
    const mentions = session?.signupMentions ?? [];
    expect(mentions.find((m) => m.username === 'Loanati')).toEqual(
      expect.objectContaining({ uncounted: true }),
    );
    expect(mentions.map((m) => m.username)).not.toContain('76561198000002888');
  });

  it('an occupant who never joined the session does not pull it in', async () => {
    const { bindingB } = await seedSharedSession();
    const rowB = await presenceRow(bindingB, opened, ['oq3-charlie']);

    expect(await recapEvents(testApp.db, bindingB, opened, rowB)).toEqual([]);
    expect(await recapEvents(testApp.db, bindingB, opened)).toEqual([]);
  });
});

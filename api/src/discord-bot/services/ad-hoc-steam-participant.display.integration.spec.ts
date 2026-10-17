/**
 * ROK-1821 (RCA F4, missing test 5) — the name a game-server row shows.
 *
 * Spike ruling: the in-game character name is for UNLINKED players only. A
 * server player whose SteamID resolves to a Raid Ledger user shows as that
 * user (display name, else username), and a character rename never
 * overwrites it. An unlinked row still follows renames. ROK-1822: no avatar
 * is written (the web builds one only from a Discord id, which a Steam row
 * lacks), and the character name is kept in `character_name` for every row.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { renameSteamOnlyRow } from './ad-hoc-server-presence.helpers';

const t = schema.adHocParticipants;
const STEAM_A = '76561198000000011';

let testApp: TestApp;
let service: AdHocParticipantService;

async function insertEvent(): Promise<number> {
  const now = new Date();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        duration: [now, new Date(now.getTime() + 3_600_000)],
        isAdHoc: true,
        adHocStatus: 'live',
      })
      .returning(),
    'event',
  );
  return event.id;
}

/** A Raid Ledger user linked to STEAM_A. */
async function insertLinkedUser(displayName: string | null): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username: 'rl-username',
        displayName,
        avatar: 'rl-avatar-hash',
        steamId: STEAM_A,
      })
      .returning(),
    'user',
  );
  return user.id;
}

async function steamRow(eventId: number) {
  const rows = await testApp.db
    .select()
    .from(t)
    .where(and(eq(t.eventId, eventId), eq(t.steamId, STEAM_A)));
  return nonEmpty(rows, 'steam row')[0];
}

const member = (displayName: string, userId: number | null) => ({
  steamId: STEAM_A,
  displayName,
  userId,
});

beforeAll(async () => {
  testApp = await getTestApp();
  service = new AdHocParticipantService(testApp.db, new EventEmitter2());
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Steam row display identity — linked players (ROK-1821 F4)', () => {
  it('a linked server player shows their Raid Ledger name, not the character name, and keeps the character name aside', async () => {
    const eventId = await insertEvent();
    const userId = await insertLinkedUser('RokRL');
    await service.addServerParticipant(eventId, member('rok', userId));

    const row = await steamRow(eventId);
    expect([
      row.discordUsername,
      row.discordAvatarHash,
      row.characterName,
    ]).toEqual(['RokRL', null, 'rok']);
  });

  it('falls back to the username when the user has no display name', async () => {
    const eventId = await insertEvent();
    const userId = await insertLinkedUser(null);
    await service.addServerParticipant(eventId, member('rok', userId));

    expect((await steamRow(eventId)).discordUsername).toBe('rl-username');
  });

  it('a rejoin under a new character name keeps the Raid Ledger name', async () => {
    const eventId = await insertEvent();
    const userId = await insertLinkedUser('RokRL');
    await service.addServerParticipant(eventId, member('rok', userId));
    await service.markServerLeave(eventId, STEAM_A);
    await service.addServerParticipant(eventId, member('rok-alt', userId));

    expect((await steamRow(eventId)).discordUsername).toBe('RokRL');
  });

  it('a character rename line does not overwrite a linked row', async () => {
    const eventId = await insertEvent();
    const userId = await insertLinkedUser('RokRL');
    await service.addServerParticipant(eventId, member('rok', userId));
    await renameSteamOnlyRow(testApp.db, eventId, {
      steamId: STEAM_A,
      displayName: 'rok-renamed',
    });

    const row = await steamRow(eventId);
    expect([row.discordUsername, row.characterName]).toEqual([
      'RokRL',
      'rok-renamed',
    ]);
  });

  it('an unlinked row that becomes linked takes the Raid Ledger name', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, member('rok', null));
    const userId = await insertLinkedUser('RokRL');
    await service.addServerParticipant(eventId, member('rok', userId));

    const row = await steamRow(eventId);
    expect([row.discordUsername, row.userId]).toEqual(['RokRL', userId]);
  });
});

describe('Steam row display identity — unlinked players (ROK-1821 F4)', () => {
  it('an unlinked player shows the character name and follows renames', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, member('Ragnhild', null));
    expect((await steamRow(eventId)).discordUsername).toBe('Ragnhild');

    await renameSteamOnlyRow(testApp.db, eventId, {
      steamId: STEAM_A,
      displayName: 'Bjorn',
    });
    expect((await steamRow(eventId)).discordUsername).toBe('Bjorn');

    await service.markServerLeave(eventId, STEAM_A);
    await service.addServerParticipant(eventId, member('Sigrid', null));
    const row = await steamRow(eventId);
    expect([row.discordUsername, row.discordAvatarHash]).toEqual([
      'Sigrid',
      null,
    ]);
  });

  it('an unlinked row that rejoins without a name does not get its previous character name back', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, member('Ragnhild', null));
    await service.markServerLeave(eventId, STEAM_A);
    await service.addServerParticipant(eventId, member(STEAM_A, null));

    const row = await steamRow(eventId);
    expect([row.discordUsername, row.characterName]).toEqual([STEAM_A, null]);
  });

  it("a nameless rejoin that folds the closed Steam row into the user's voice row does not bring its old character name back", async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, member('Ragnhild', null));
    await service.markServerLeave(eventId, STEAM_A);
    const userId = await insertLinkedUser('RokRL');
    await service.addParticipant(eventId, {
      discordUserId: 'rok1822-r3-voice',
      discordUsername: 'VoiceName',
      discordAvatarHash: null,
      userId,
    });
    await service.addServerParticipant(eventId, member(STEAM_A, userId));

    const row = await steamRow(eventId);
    expect([row.discordUserId, row.characterName]).toEqual([
      'rok1822-r3-voice',
      null,
    ]);
  });
});

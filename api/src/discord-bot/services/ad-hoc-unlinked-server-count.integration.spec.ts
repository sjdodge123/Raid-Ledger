/**
 * ROK-1888 AC5/AC6 (ruling 2 + ruling 1) — real-DB counts for a Quick Play
 * whose roster mixes voice members and game-server rows.
 *
 * - AC5: a voice member plus an UNLINKED server row (the same person, not yet
 *   linked) counts once. The card reads `1 playing`, the push line
 *   `1 signed up`, ENDED `Attendance · 1 player`, and the server row renders
 *   `**Loanati** · on server`.
 * - AC6: a LINKED server row (another RL user) renders by name and counts; an
 *   anonymous row still shows `+N on server` but is not counted.
 * - Ruling 1: the unlinked row still holds the session out of grace
 *   (`getOpenRowCount`) while leaving the "N playing" count (`getActiveCount`).
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import {
  buildEmbedEventData,
  readParticipants,
  spawnCardParticipants,
  type AdHocNotificationDeps,
} from './ad-hoc-notification.helpers';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { buildQuickPlayEmbed } from './discord-embed-quickplay.helpers';
import type { EmbedEventData } from './discord-embed.factory';

const STEAM_UNLINKED = '76561198000000021';
const STEAM_LINKED = '76561198000000022';
const STEAM_ANON = '76561198000000023';
const VOICE_DISCORD_ID = 'rok1888-voice-1';
const CONTEXT = { communityName: 'RL', clientUrl: 'https://rl.test' };

let testApp: TestApp;
let service: AdHocParticipantService;
let deps: AdHocNotificationDeps;

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

async function insertVoiceMember(eventId: number): Promise<void> {
  await service.addParticipant(eventId, {
    discordUserId: VOICE_DISCORD_ID,
    discordUsername: 'Rok',
    discordAvatarHash: null,
    userId: null,
  });
}

async function insertOtherRlUser(): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username: 'other-rl',
        displayName: 'Brakk',
        steamId: STEAM_LINKED,
      })
      .returning(),
    'user',
  );
  return user.id;
}

async function embedData(eventId: number): Promise<EmbedEventData> {
  const participants = await readParticipants(testApp.db, eventId);
  const data = await buildEmbedEventData(deps, eventId, participants);
  if (!data) throw new Error(`no embed data for event ${String(eventId)}`);
  return data;
}

function render(data: EmbedEventData, state: 'live' | 'ended') {
  const result = buildQuickPlayEmbed(data, CONTEXT, state);
  const json = result.embed.toJSON();
  return {
    author: json.author?.name ?? '',
    description: json.description ?? '',
    content: result.content,
  };
}

/** Close the voice member's row the way a voice leave does. */
async function voiceMemberLeaves(eventId: number): Promise<void> {
  const t = schema.adHocParticipants;
  await testApp.db
    .update(t)
    .set({ leftAt: new Date(), inVoice: false })
    .where(
      and(
        eq(t.eventId, eventId),
        eq(t.discordUserId, VOICE_DISCORD_ID),
        isNull(t.leftAt),
      ),
    );
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = new AdHocParticipantService(testApp.db, new EventEmitter2());
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

describe('ROK-1888 AC5 — voice member + unlinked server row counts once', () => {
  async function seedAc5(): Promise<number> {
    const eventId = await insertEvent();
    await insertVoiceMember(eventId);
    await service.addServerParticipant(eventId, {
      steamId: STEAM_UNLINKED,
      displayName: 'Loanati',
      userId: null,
    });
    return eventId;
  }

  it('the card counts 1, signs up 1, and suffixes the server row', async () => {
    const data = await embedData(await seedAc5());
    expect(data.signupCount).toBe(1);
    const live = render(data, 'live');
    expect(live.author).toContain('1 playing');
    expect(live.content).toContain('1 signed up');
    expect(live.description).toContain('**Rok**');
    expect(live.description).toContain('**Loanati** · on server');
  });

  it('the ENDED card reports Attendance · 1 player', async () => {
    const eventId = await seedAc5();
    const participants = await readParticipants(testApp.db, eventId, true);
    const data = await buildEmbedEventData(deps, eventId, participants);
    if (!data) throw new Error('no embed data');
    expect(render(data, 'ended').description).toContain(
      'Attendance \u00B7 1 player',
    );
  });

  it('"N playing" excludes the unlinked row; grace still sees it (ruling 1)', async () => {
    const eventId = await seedAc5();
    expect([
      await service.getActiveCount(eventId),
      await service.getOpenRowCount(eventId),
    ]).toEqual([1, 2]);

    await voiceMemberLeaves(eventId);
    // The unlinked player is still on the server: 0 "playing", but one open
    // row keeps `afterServerLeave` from starting grace.
    expect([
      await service.getActiveCount(eventId),
      await service.getOpenRowCount(eventId),
    ]).toEqual([0, 1]);
  });
});

describe('ROK-1888 AC6 — linked server rows count, anonymous rows do not', () => {
  it('a linked other-user row renders by name and counts; anonymous shows +1 on server uncounted', async () => {
    const eventId = await insertEvent();
    await insertVoiceMember(eventId);
    const otherId = await insertOtherRlUser();
    await service.addServerParticipant(eventId, {
      steamId: STEAM_LINKED,
      displayName: 'brakk-char',
      userId: otherId,
    });
    await service.addServerParticipant(eventId, {
      steamId: STEAM_ANON,
      displayName: STEAM_ANON,
      userId: null,
    });

    const data = await embedData(eventId);
    expect(data.signupCount).toBe(2);
    const live = render(data, 'live');
    expect(live.author).toContain('2 playing');
    expect(live.description).toContain('**Brakk**');
    expect(live.description).not.toContain('**Brakk** · on server');
    expect(live.description).toContain('+1 on server');
    // Voice + linked; the anonymous row is unlinked too, so it is not "playing".
    expect(await service.getActiveCount(eventId)).toBe(2);
  });
});

describe('ROK-1888 Codex r1 P2 — the initial spawn card reads stored flags', () => {
  async function spawnCard(
    eventId: number,
    roster: Array<{ discordUserId: string | null; discordUsername: string }>,
  ): Promise<EmbedEventData> {
    const participants = await spawnCardParticipants(deps, eventId, roster);
    const data = await buildEmbedEventData(deps, eventId, participants);
    if (!data) throw new Error(`no embed data for event ${String(eventId)}`);
    return data;
  }

  it('a server-born spawn card suffixes the unlinked player and counts nobody', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, {
      steamId: STEAM_UNLINKED,
      displayName: 'Loanati',
      userId: null,
    });
    const data = await spawnCard(eventId, [
      { discordUserId: null, discordUsername: 'Loanati' },
    ]);
    expect({
      signupCount: data.signupCount,
      description: render(data, 'live').description,
    }).toEqual({
      signupCount: 0,
      description: expect.stringContaining('**Loanati** · on server'),
    });
  });

  it('a voice-born spawn card carries the Discord-only join hint', async () => {
    const eventId = await insertEvent();
    await insertVoiceMember(eventId);
    const data = await spawnCard(eventId, [
      { discordUserId: VOICE_DISCORD_ID, discordUsername: 'Rok' },
    ]);
    expect(data.discordOnlyPresent).toBe(true);
  });
});

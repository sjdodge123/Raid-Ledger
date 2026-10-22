/**
 * ROK-1888 review m3 — a bot restart (or a dropped voiceStateUpdate) leaves an
 * in-voice participant row open for a member who already left the channel.
 * Recovery re-adds the members who are present; it must also close the open
 * voice rows of members who are absent, or durations and "N in voice" drift.
 */
import { Collection } from 'discord.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from '../services/ad-hoc-participant.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { createVoiceQuickPlay } from '../services/ad-hoc-game-spawn-lock';
import { recoverFromVoiceChannels } from './voice-state-recovery.handlers';
import type { VoiceHandlerDeps } from './voice-handler-deps';
import type { ResolvedBinding } from './voice-state.helpers';

const p = schema.adHocParticipants;
const GUILD = 'guild-1888-m3';
const CHANNEL = '1888-m3-voice';
const LFG_CHANNEL = '1888-m3-lfg-now-voice';

let testApp: TestApp;

const member = (id: string) => ({
  displayName: id,
  user: { username: id, avatar: null, bot: false },
});

/** A guild whose voice channels hold exactly the given members. */
function fakeClient(rooms: Record<string, string[]>) {
  const channels = new Collection(
    Object.entries(rooms).map(([id, present]) => [
      id,
      {
        isVoiceBased: () => true,
        members: new Collection(present.map((m) => [m, member(m)])),
      },
    ]),
  );
  const guild = { channels: { cache: channels } };
  return {
    getClient: () => ({ guilds: { cache: new Map([[GUILD, guild]]) } }),
    getGuildId: () => GUILD,
  };
}

function depsFor(
  present: string[],
  withChannels = true,
  rooms?: Record<string, string[]>,
): VoiceHandlerDeps {
  const layout = rooms ?? (withChannels ? { [CHANNEL]: present } : {});
  return {
    logger: { log: jest.fn(), error: jest.fn(), debug: jest.fn() },
    clientService: fakeClient(layout),
    channelPresence: { markDirty: jest.fn() },
    userChannelMap: new Map(),
    channelMembers: new Map(),
    db: testApp.db,
    adHocEventService: testApp.app.get(AdHocEventService),
    adHocParticipantService: new AdHocParticipantService(
      testApp.db,
      new EventEmitter2(),
    ),
  } as unknown as VoiceHandlerDeps;
}

async function liveEventWith(ids: string[]): Promise<number> {
  const [binding] = nonEmpty(
    await testApp.db
      .insert(schema.channelBindings)
      .values({
        guildId: GUILD,
        channelId: CHANNEL,
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: testApp.seed.game.id,
      })
      .returning(),
    'binding',
  );
  const spawned = await createVoiceQuickPlay(
    testApp.db,
    binding.id,
    { gameId: testApp.seed.game.id },
    { userId: null },
  );
  const eventId = spawned?.eventId;
  if (eventId === undefined) throw new Error('quick play did not spawn');
  for (const id of ids) {
    await testApp.db.insert(p).values({
      eventId,
      discordUserId: id,
      discordUsername: id,
      inVoice: true,
      joinedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
  }
  return eventId;
}

const rowOf = async (eventId: number, id: string) =>
  nonEmpty(
    await testApp.db
      .select({ inVoice: p.inVoice, leftAt: p.leftAt })
      .from(p)
      .where(and(eq(p.eventId, eventId), eq(p.discordUserId, id))),
    `row ${id}`,
  )[0];

const binding = {
  bindingId: 'b',
  gameId: null,
  bindingPurpose: 'game-voice-monitor',
} as unknown as ResolvedBinding;
/** Only CHANNEL is bound; the LFG-now temp voice channel has no binding. */
const recover = (deps: VoiceHandlerDeps) =>
  recoverFromVoiceChannels(
    deps,
    (ch) => Promise.resolve(ch === CHANNEL ? binding : null),
    jest.fn(),
  );

const statusOf = async (eventId: number) =>
  nonEmpty(
    await testApp.db
      .select({ status: schema.events.adHocStatus })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    `event ${eventId}`,
  )[0].status;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-1888 m3 — recovery closes stale in-voice rows', () => {
  it('closes the open row of a member no longer in voice; keeps the present one open', async () => {
    const eventId = await liveEventWith(['gone-m3', 'here-m3']);

    await recover(depsFor(['here-m3']));

    const gone = await rowOf(eventId, 'gone-m3');
    expect({ inVoice: gone.inVoice, closed: gone.leftAt !== null }).toEqual({
      inVoice: false,
      closed: true,
    });
    const here = await rowOf(eventId, 'here-m3');
    expect({ inVoice: here.inVoice, leftAt: here.leftAt }).toEqual({
      inVoice: true,
      leftAt: null,
    });
  });

  it('is idempotent: a second recovery leaves the closed row untouched', async () => {
    const eventId = await liveEventWith(['gone-m3']);
    await recover(depsFor([]));
    const first = (await rowOf(eventId, 'gone-m3')).leftAt;

    await recover(depsFor([]));

    expect(first).not.toBeNull();
    expect((await rowOf(eventId, 'gone-m3')).leftAt).toEqual(first);
  });

  it('closes nothing while the guild channel cache is empty', async () => {
    const eventId = await liveEventWith(['gone-m3']);

    await recover(depsFor([], false));

    expect((await rowOf(eventId, 'gone-m3')).leftAt).toBeNull();
  });

  it('keeps the open row of a member sitting in an unbound LFG-now voice channel', async () => {
    const eventId = await liveEventWith(['lfg-m3']);
    // An LFG-born session (ROK-1625) has no channel binding.
    await testApp.db
      .update(schema.events)
      .set({ channelBindingId: null })
      .where(eq(schema.events.id, eventId));

    await recover(
      depsFor([], true, { [CHANNEL]: [], [LFG_CHANNEL]: ['lfg-m3'] }),
    );

    const row = await rowOf(eventId, 'lfg-m3');
    expect({ inVoice: row.inVoice, leftAt: row.leftAt }).toEqual({
      inVoice: true,
      leftAt: null,
    });
  });

  it('starts grace when the sweep closes the last open voice row of a live event', async () => {
    const eventId = await liveEventWith(['gone-m3']);
    expect(await statusOf(eventId)).toBe('live');

    await recover(depsFor([]));

    expect(await statusOf(eventId)).toBe('grace_period');
  });

  // ROK-1888 B5: the live path never graces an LFG-born (unbound) session, and
  // its temp-channel rejoin never cancels grace — so arming it here would end
  // the session with members back in voice.
  it('does not start grace on an LFG-born (unbound) event the sweep emptied', async () => {
    const eventId = await liveEventWith(['lfg-gone-m3']);
    await testApp.db
      .update(schema.events)
      .set({ channelBindingId: null })
      .where(eq(schema.events.id, eventId));

    await recover(depsFor([], true, { [CHANNEL]: [], [LFG_CHANNEL]: [] }));

    expect((await rowOf(eventId, 'lfg-gone-m3')).leftAt).not.toBeNull();
    expect(await statusOf(eventId)).toBe('live');
  });
});

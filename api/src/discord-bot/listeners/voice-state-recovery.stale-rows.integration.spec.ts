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
import { createVoiceQuickPlay } from '../services/ad-hoc-game-spawn-lock';
import { recoverFromVoiceChannels } from './voice-state-recovery.handlers';
import type { VoiceHandlerDeps } from './voice-handler-deps';
import type { ResolvedBinding } from './voice-state.helpers';

const p = schema.adHocParticipants;
const GUILD = 'guild-1888-m3';
const CHANNEL = '1888-m3-voice';

let testApp: TestApp;

const member = (id: string) => ({
  displayName: id,
  user: { username: id, avatar: null, bot: false },
});

/** A guild whose one voice channel holds exactly `present`. */
function fakeClient(present: string[], withChannels = true) {
  const members = new Collection(present.map((id) => [id, member(id)]));
  const channel = { isVoiceBased: () => true, members };
  const channels = new Collection(withChannels ? [[CHANNEL, channel]] : []);
  const guild = { channels: { cache: channels } };
  return {
    getClient: () => ({ guilds: { cache: new Map([[GUILD, guild]]) } }),
    getGuildId: () => GUILD,
  };
}

function depsFor(present: string[], withChannels = true): VoiceHandlerDeps {
  return {
    logger: { log: jest.fn(), error: jest.fn(), debug: jest.fn() },
    clientService: fakeClient(present, withChannels),
    channelPresence: { markDirty: jest.fn() },
    userChannelMap: new Map(),
    channelMembers: new Map(),
    db: testApp.db,
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
const recover = (deps: VoiceHandlerDeps) =>
  recoverFromVoiceChannels(deps, () => Promise.resolve(binding), jest.fn());

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
});

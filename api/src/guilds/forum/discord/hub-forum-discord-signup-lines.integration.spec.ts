/**
 * ROK-2271 — the signup-line state loader against a real database: status,
 * roster role / bench, character, running late (ROK-1379) and roach-out
 * timing (ROK-421) per member, keyed by Discord id (linked or anonymous),
 * narrowed by a Discord-id list.
 */
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  bootDiscussion,
  setSignupStatus,
  signUp,
  type DiscussionCtx,
  type Scene,
} from '../event-discussion/event-discussion.test-fixtures';
import { loadSignupLineStates } from './hub-forum-discord-signup-lines.queries';
import {
  bareScene,
  giveDiscordIds,
  signUpBench,
  type Pingable,
} from './hub-forum-discord-signup-pings.test-fixtures';
import { snowflake } from './hub-forum-discord.test-fixtures';

const HOUR = 60 * 60 * 1000;

let ctx: DiscussionCtx;
let did: Record<Pingable, string>;

beforeAll(async () => {
  ctx = await bootDiscussion('hfdsl');
  did = await giveDiscordIds(ctx);
});

const db = () => ctx.posts.testApp.db;
const load = (eventId: number, ids?: string[]) =>
  loadSignupLineStates(db(), eventId, ids);

async function eventStart(eventId: number): Promise<Date> {
  const [e] = nonEmpty(
    await db()
      .select({ duration: schema.events.duration })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    'event',
  );
  return e.duration[0];
}

async function nameOf(who: Pingable): Promise<string> {
  const [u] = nonEmpty(
    await db()
      .select({ d: schema.users.displayName, u: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.ids[who])),
    'user',
  );
  return u.d ?? u.u;
}

/** Put `who`'s signup on a fresh character and roster slot `role`. */
async function onCharacter(s: Scene, signupId: number, who: Pingable) {
  const [c] = nonEmpty(
    await db()
      .insert(schema.characters)
      .values({
        userId: ctx.ids[who],
        gameId: ctx.posts.testApp.seed.game.id,
        name: `Thrall${s.eventId}`,
        class: 'Warrior',
        spec: 'Protection',
      })
      .returning({ id: schema.characters.id }),
    'character',
  );
  await db()
    .update(schema.eventSignups)
    .set({ characterId: c.id })
    .where(eq(schema.eventSignups.id, signupId));
  await db()
    .insert(schema.rosterAssignments)
    .values({ eventId: s.eventId, signupId, role: 'tank', position: 1 });
}

describe('loadSignupLineStates', () => {
  it('loads role, character, late, bench, tentative and roach-out state', async () => {
    const s = await bareScene(ctx);
    const signedId = await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await onCharacter(s, signedId, 'signed');
    await db()
      .update(schema.eventSignups)
      .set({ runningLateAt: new Date(), lateMinutes: 15 })
      .where(eq(schema.eventSignups.id, signedId));
    await signUpBench(ctx, s.eventId);
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    await signUp(ctx, s.eventId, 'declined', 'signed_up');
    await setSignupStatus(ctx, s.eventId, 'declined', 'roached_out');
    const start = await eventStart(s.eventId);
    await db()
      .update(schema.eventSignups)
      .set({ roachedOutAt: new Date(start.getTime() - 3 * HOUR) })
      .where(
        and(
          eq(schema.eventSignups.eventId, s.eventId),
          eq(schema.eventSignups.userId, ctx.ids.declined),
        ),
      );

    const got = await load(s.eventId);

    expect([...got.keys()].sort()).toEqual(
      [did.signed, did.bench, did.tentative, did.declined].sort(),
    );
    expect(got.get(did.signed)).toEqual({
      discordId: did.signed,
      displayName: await nameOf('signed'),
      state: {
        status: 'signed_up',
        role: 'tank',
        bench: false,
        character: {
          name: `Thrall${s.eventId}`,
          className: 'Warrior',
          spec: 'Protection',
        },
        late: true,
        lateMinutes: 15,
        roachedHoursBefore: null,
      },
    });
    expect(got.get(did.bench)?.state).toMatchObject({
      status: 'signed_up',
      role: null,
      bench: true,
      character: null,
      late: false,
    });
    expect(got.get(did.tentative)?.state.status).toBe('tentative');
    const roach = got.get(did.declined)?.state;
    expect(roach?.status).toBe('roached_out');
    expect(roach?.roachedHoursBefore).toBeCloseTo(3, 5);
  });

  it('keys an anonymous Discord signup by its Discord id and username', async () => {
    const s = await bareScene(ctx);
    const anon = snowflake();
    await db().insert(schema.eventSignups).values({
      eventId: s.eventId,
      discordUserId: anon,
      discordUsername: 'AnonPug',
      status: 'signed_up',
    });

    const got = await load(s.eventId);

    expect(got.get(anon)?.displayName).toBe('AnonPug');
    expect(got.get(anon)?.state.status).toBe('signed_up');
  });

  it('narrows to the given Discord ids and skips non-Discord signers', async () => {
    const s = await bareScene(ctx);
    await signUp(ctx, s.eventId, 'signed', 'signed_up');
    await signUp(ctx, s.eventId, 'tentative', 'tentative');
    await db()
      .insert(schema.eventSignups)
      .values({
        eventId: s.eventId,
        discordUserId: `unlinked:${s.eventId}`,
        status: 'signed_up',
      });

    expect([...(await load(s.eventId)).keys()].sort()).toEqual(
      [did.signed, did.tentative].sort(),
    );
    expect([...(await load(s.eventId, [did.tentative])).keys()]).toEqual([
      did.tentative,
    ]);
    expect((await load(s.eventId, [])).size).toBe(0);
  });
});

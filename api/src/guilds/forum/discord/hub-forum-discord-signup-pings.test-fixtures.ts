/**
 * ROK-2260 — seeding for the signup-ping integration specs. Builds on the
 * event-discussion scene (fresh hub + event + live thread per test) but
 * starts it with NO signups, so each case adds exactly the signups it
 * asserts on, and gives the actors real Discord snowflakes (the flush skips
 * `local:` ids — only Discord users can be @mentioned).
 * Excluded from `nest build` by the `*.test-fixtures.ts` pattern.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import {
  newScene,
  signUp,
  type Actor,
  type DiscussionCtx,
  type Scene,
} from '../event-discussion/event-discussion.test-fixtures';
import { snowflake } from './hub-forum-discord.test-fixtures';

/** The actors a ping spec signs up. */
export const PINGABLE = [
  'signed',
  'bench',
  'tentative',
  'declined',
  'pug',
] as const;
export type Pingable = (typeof PINGABLE)[number];

/** Give every pingable actor a real Discord id; returns them by actor. */
export async function giveDiscordIds(
  ctx: DiscussionCtx,
): Promise<Record<Pingable, string>> {
  const out: Partial<Record<Pingable, string>> = {};
  for (const who of PINGABLE) {
    const id = snowflake();
    await ctx.posts.testApp.db
      .update(schema.users)
      .set({ discordId: id })
      .where(eq(schema.users.id, ctx.ids[who]));
    out[who] = id;
  }
  const { signed, bench, tentative, declined, pug } = out;
  if (!signed || !bench || !tentative || !declined || !pug) {
    throw new Error('giveDiscordIds: an actor got no id');
  }
  return { signed, bench, tentative, declined, pug };
}

/** A fresh hub + event + live thread with every signup removed. */
export async function bareScene(ctx: DiscussionCtx): Promise<Scene> {
  const s = await newScene(ctx);
  const db = ctx.posts.testApp.db;
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, s.eventId));
  await db
    .delete(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, s.eventId));
  return s;
}

/** Bind the scene's hub to a (fake) Discord forum as the admin. */
export async function bindHub(
  ctx: DiscussionCtx,
  guildId: number,
): Promise<void> {
  const res = await ctx.posts.testApp.request
    .put(`/guilds/${guildId}/forum-discord`)
    .set('Authorization', `Bearer ${ctx.tokens.admin}`)
    .send({ mode: 'create', ack: true });
  expect(res.status).toBe(200);
}

/** A `signed_up` signup on the bench (roster slot `bench`). */
export async function signUpBench(
  ctx: DiscussionCtx,
  eventId: number,
): Promise<void> {
  const signupId = await signUp(ctx, eventId, 'bench', 'signed_up');
  await ctx.posts.testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role: 'bench', position: 1 });
}

/** Withdraw `who`'s signup (the row goes, as a cancel does). */
export async function cancelSignup(
  ctx: DiscussionCtx,
  eventId: number,
  who: Actor,
): Promise<void> {
  const s = schema.eventSignups;
  const gone = await ctx.posts.testApp.db
    .delete(s)
    .where(and(eq(s.eventId, eventId), eq(s.userId, ctx.ids[who])))
    .returning({ id: s.id });
  if (gone.length !== 1) {
    throw new Error(`cancelSignup: ${who} had no signup on ${eventId}`);
  }
}

/**
 * ROK-2226 L3c — seeding for the §6 access-matrix integration spec. Builds on
 * the hub-post fixtures (officer A + B = Leaders, `plain` = member, `outsider`
 * = visitor) and adds one actor per remaining §6 row. Every test gets a FRESH
 * hub + event + thread (`newScene`), so randomized order shares nothing.
 * Excluded from `nest build` by the `*.test-fixtures.ts` pattern.
 */
import type { Response } from 'supertest';
import { and, eq } from 'drizzle-orm';
import { nonEmpty } from '../../../common/testing/narrow';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import * as schema from '../../../drizzle/schema';
import {
  bootPostsApp,
  link,
  newHub,
  resetThrottler,
  type PostsCtx,
  type Who,
} from '../../posts/hub-posts.test-fixtures';
import { HubForumThrottleGuard } from '../hub-forum-throttle.guard';
import { EventDiscussionReplyThrottleGuard } from './event-discussion-throttle.guard';
import { findLiveEventThread } from './event-discussion.queries';
import { syncEventDiscussion } from './event-discussion.sync';

const HOUR = 3_600_000;

/** The §6 actors beyond the hub-post four. */
export type Extra =
  'admin' | 'signed' | 'bench' | 'tentative' | 'pug' | 'declined' | 'creator';
export type Actor = Who | Extra;
interface Made {
  id: number;
  token: string;
}

export interface DiscussionCtx {
  posts: PostsCtx;
  tokens: Record<Actor, string>;
  ids: Record<Actor, number>;
}

/** One hub, one tagged event (ends in 2 h) and its live thread. */
export interface Scene {
  guildId: number;
  eventId: number;
  threadId: number;
}

async function mkExtra(
  posts: PostsCtx,
  who: Extra,
  tag: string,
): Promise<Made> {
  const role = who === 'admin' ? 'admin' : 'member';
  const [u] = nonEmpty(
    await posts.testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}-${who}@event-discussion.test`,
        username: `${tag}-${who}`,
        displayName: `${tag} ${who}`,
        role,
      })
      .returning(),
    'user',
  );
  const token = await signTestAccessToken(posts.testApp, {
    sub: u.id,
    username: u.username,
    role,
  });
  return { id: u.id, token };
}

/** One field of every extra actor. */
function pick<T>(x: Record<Extra, Made>, f: (u: Made) => T): Record<Extra, T> {
  return {
    admin: f(x.admin),
    signed: f(x.signed),
    bench: f(x.bench),
    tentative: f(x.tentative),
    pug: f(x.pug),
    declined: f(x.declined),
    creator: f(x.creator),
  };
}

/** Boot the app (blizzard active) and create all eleven actors. */
export async function bootDiscussion(tag: string): Promise<DiscussionCtx> {
  const posts = await bootPostsApp(tag);
  const mk = (who: Extra): Promise<Made> => mkExtra(posts, who, tag);
  const x: Record<Extra, Made> = {
    admin: await mk('admin'),
    signed: await mk('signed'),
    bench: await mk('bench'),
    tentative: await mk('tentative'),
    pug: await mk('pug'),
    declined: await mk('declined'),
    creator: await mk('creator'),
  };
  return {
    posts,
    tokens: { ...posts.tokens, ...pick(x, (u) => u.token) },
    ids: { ...posts.userIds, ...pick(x, (u) => u.id) },
  };
}

/** Empty every throttle the discussion routes can hit. */
export function resetThrottles(ctx: DiscussionCtx): void {
  const app = ctx.posts.testApp.app;
  app.get(HubForumThrottleGuard, { strict: false }).reset();
  app.get(EventDiscussionReplyThrottleGuard, { strict: false }).reset();
  resetThrottler(ctx.posts);
}

async function newEvent(ctx: DiscussionCtx, guildId: number): Promise<number> {
  const end = new Date(Date.now() + 2 * HOUR);
  const [e] = nonEmpty(
    await ctx.posts.testApp.db
      .insert(schema.events)
      .values({
        title: 'Molten Core',
        creatorId: ctx.ids.creator,
        gameId: ctx.posts.testApp.seed.game.id,
        guildId,
        isAdHoc: false,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return e.id;
}

/** Insert a signup for `who` (no roster slot). */
export async function signUp(
  ctx: DiscussionCtx,
  eventId: number,
  who: Actor,
  status: 'signed_up' | 'tentative',
): Promise<number> {
  const [s] = nonEmpty(
    await ctx.posts.testApp.db
      .insert(schema.eventSignups)
      .values({ eventId, userId: ctx.ids[who], status })
      .returning(),
    'signup',
  );
  return s.id;
}

/**
 * Members: officer A/B, plain (fixture) + signed, bench, tentative, declined.
 * Signups: signed, bench (benched), tentative (tentative), pug, declined
 * (still `signed_up` — `setSignupStatus` declines it mid-test).
 */
export async function newScene(ctx: DiscussionCtx): Promise<Scene> {
  const guildId = await newHub(ctx.posts);
  for (const who of ['signed', 'bench', 'tentative', 'declined'] as const) {
    await link(ctx.posts, guildId, ctx.ids[who]);
  }
  const eventId = await newEvent(ctx, guildId);
  for (const who of ['signed', 'bench', 'pug', 'declined'] as const) {
    const id = await signUp(ctx, eventId, who, 'signed_up');
    if (who !== 'bench') continue;
    await ctx.posts.testApp.db
      .insert(schema.rosterAssignments)
      .values({ eventId, signupId: id, role: 'bench', position: 1 });
  }
  await signUp(ctx, eventId, 'tentative', 'tentative');
  await syncEventDiscussion(ctx.posts.testApp.db, eventId, new Date());
  const live = await findLiveEventThread(ctx.posts.testApp.db, eventId);
  if (!live) throw new Error('scene: no live event thread');
  return { guildId, eventId, threadId: live.id };
}

/** Another tagged event in `guildId` with its (empty) live thread; returns the thread id. */
export async function addEventThread(
  ctx: DiscussionCtx,
  guildId: number,
): Promise<number> {
  const eventId = await newEvent(ctx, guildId);
  await syncEventDiscussion(ctx.posts.testApp.db, eventId, new Date());
  const live = await findLiveEventThread(ctx.posts.testApp.db, eventId);
  if (!live) throw new Error('addEventThread: no live event thread');
  return live.id;
}

/** Move a signup to `status` (e.g. `declined`). */
export async function setSignupStatus(
  ctx: DiscussionCtx,
  eventId: number,
  who: Actor,
  status: string,
): Promise<void> {
  const s = schema.eventSignups;
  const rows = await ctx.posts.testApp.db
    .update(s)
    .set({ status })
    .where(and(eq(s.eventId, eventId), eq(s.userId, ctx.ids[who])))
    .returning({ id: s.id });
  if (rows.length !== 1) throw new Error(`no signup for ${who}`);
}

/** End the event 25 h ago and resync, so `write_closes_at` has passed. */
export async function endEvent(
  ctx: DiscussionCtx,
  eventId: number,
): Promise<void> {
  const end = new Date(Date.now() - 25 * HOUR);
  await ctx.posts.testApp.db
    .update(schema.events)
    .set({ duration: [new Date(end.getTime() - 2 * HOUR), end] })
    .where(eq(schema.events.id, eventId));
  await syncEventDiscussion(ctx.posts.testApp.db, eventId, new Date());
}

/** Untag the event and resync, so its thread is detached (stays in the hub). */
export async function untagEvent(
  ctx: DiscussionCtx,
  eventId: number,
): Promise<void> {
  await ctx.posts.testApp.db
    .update(schema.events)
    .set({ guildId: null })
    .where(eq(schema.events.id, eventId));
  await syncEventDiscussion(ctx.posts.testApp.db, eventId, new Date());
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/** An authenticated request as `who`. */
export function as(
  ctx: DiscussionCtx,
  who: Actor,
  method: Method,
  path: string,
  body?: object,
) {
  const req = ctx.posts.testApp.request[method](path).set(
    'Authorization',
    `Bearer ${ctx.tokens[who]}`,
  );
  return body === undefined ? req : req.send(body);
}

/** Status + message, so a wrong refusal fails naming both. */
export function outcome(res: Response): { status: number; message: unknown } {
  const body: unknown = res.body;
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? body.message
      : undefined;
  return { status: res.status, message };
}

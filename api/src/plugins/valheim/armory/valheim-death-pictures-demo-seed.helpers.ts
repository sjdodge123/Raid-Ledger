/**
 * ROK-1941 L6 — DEMO_MODE death-pictures fixture writes. On the worker's
 * Deaths-fixture hub (ROK-1930), the `top` character gets `count` fresh
 * log deaths, each linked to a generated `death` picture stored through the
 * real `HubMediaService.ingest` (stub downloader, never a real image), plus
 * optionally one hidden and one removed picture. A re-run deletes the
 * previous run's pictures (rows + files) and their deaths first, so the
 * state per worker is the same after every call.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../../../drizzle/schema';
import type { HubMediaDownloader } from '../../../hub-media/hub-media-download';
import { unlinkMediaFiles } from '../../../hub-media/hub-media.files';
import type { HubMediaService } from '../../../hub-media/hub-media.service';
import { solidPng } from '../../../hub-media/hub-media.testing';
import { VALHEIM_LINK_FIXTURE_SLOTS } from '../link/valheim-link-demo-seed.helpers';
import { DEATHS_FIXTURE_CHARACTERS } from './valheim-deaths-demo-seed.data';
import {
  deathsSteamId,
  ensureDeathsUsers,
  type DeathsFixture,
} from './valheim-deaths-demo-seed.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Every demo death picture's provenance key starts with this. */
export const DEMO_DEATH_PREFIX = 'demo-death:';
const MAX_COUNT = 24;

const BodySchema = z
  .object({
    worker: z
      .number()
      .int()
      .min(0)
      .max(VALHEIM_LINK_FIXTURE_SLOTS - 1)
      .default(0),
    count: z.number().int().min(1).max(MAX_COUNT).default(5),
    hidden: z.boolean().default(false),
    removed: z.boolean().default(false),
  })
  .strict();

/** A parsed `POST /admin/test/valheim/death-pictures` body. */
export type DeathPicturesRequest = z.infer<typeof BodySchema>;

/** `POST /admin/test/valheim/death-pictures` response. */
export interface DeathPicturesFixture {
  serverId: number;
  guildId: number;
  /** The `top` character the pictures belong to (= every picture's author). */
  characterName: string;
  /** The visible pictures, newest first. */
  mediaIds: number[];
  hiddenMediaId: number | null;
  removedMediaId: number | null;
  users: DeathsFixture['users'];
}

/** Parse the body or 400 with the expected shape. */
export function parseDeathPicturesBody(body: unknown): DeathPicturesRequest {
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      `Expected { worker?: 0..${VALHEIM_LINK_FIXTURE_SLOTS - 1}, count?: 1..${MAX_COUNT}, hidden?: boolean, removed?: boolean }`,
    );
  }
  return parsed.data;
}

/** Generated pictures, no network: the URL's last segment picks the colour. */
export const demoDeathDownloader: HubMediaDownloader = {
  download(url: URL): Promise<Buffer> {
    const i = Number(url.pathname.split('/').pop()?.replace('.png', '') ?? 0);
    return solidPng(640, 360, i + 3);
  },
};

/** The worker's `top` character: its name and SteamID. */
export function topCharacter(worker: number): {
  name: string;
  steamId: string;
} {
  const plan = DEATHS_FIXTURE_CHARACTERS[0];
  if (!plan) throw new Error('death pictures: cast plan incomplete');
  return { name: plan.name, steamId: deathsSteamId(worker, 0) };
}

/** Whether the server already carries the worker's `top` character. */
export async function hasTopCharacter(
  db: Db,
  serverId: number,
  worker: number,
): Promise<boolean> {
  const P = schema.valheimProfiles;
  const [row] = await db
    .select({ id: P.id })
    .from(P)
    .where(
      and(
        eq(P.pelicanServerId, serverId),
        eq(P.steamId, topCharacter(worker).steamId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Delete the previous run's demo pictures (rows + files) and their deaths. */
export async function clearDemoDeathPictures(
  db: Db,
  serverId: number,
  guildId: number,
): Promise<void> {
  const M = schema.hubMedia;
  const old = await db
    .select({ id: M.id, storageName: M.storageName })
    .from(M)
    .where(
      and(
        eq(M.guildId, guildId),
        like(M.provenanceKey, `${DEMO_DEATH_PREFIX}%`),
      ),
    );
  if (old.length === 0) return;
  const ids = old.map((r) => r.id);
  const D = schema.valheimPlayerDeaths;
  await db
    .delete(D)
    .where(and(eq(D.pelicanServerId, serverId), inArray(D.hubMediaId, ids)));
  await db.delete(M).where(inArray(M.id, ids));
  for (const r of old) await unlinkMediaFiles(guildId, r.storageName);
}

interface PictureCtx {
  db: Db;
  store: HubMediaService;
  serverId: number;
  guildId: number;
  character: { name: string; steamId: string };
  now: Date;
}

/** Ingest picture `i` (i minutes before `now`) and log its linked death. */
async function seedPicture(ctx: PictureCtx, i: number): Promise<number> {
  const capturedAt = new Date(ctx.now.getTime() - i * 60_000);
  const result = await ctx.store.ingest({
    guildId: ctx.guildId,
    source: 'discord',
    kind: 'death',
    provenanceKey: `${DEMO_DEATH_PREFIX}${i}`,
    sourceUrl: `https://cdn.discordapp.com/attachments/demo-death/${i}.png`,
    authorName: ctx.character.name,
    caption: `Died to a Troll #${i + 1}`,
    capturedAt,
    discord: null,
  });
  if (result.status !== 'stored') {
    throw new Error(`death pictures: ingest ${i} → ${result.status}`);
  }
  await ctx.db.insert(schema.valheimPlayerDeaths).values({
    pelicanServerId: ctx.serverId,
    characterName: ctx.character.name,
    steamId: ctx.character.steamId,
    source: 'log',
    loggedAt: capturedAt.toISOString().slice(0, 19),
    occurredAt: capturedAt,
    hubMediaId: result.mediaId,
  });
  return result.mediaId;
}

/** Seed one picture, then hide it (or tombstone it + unlink its files). */
async function seedModerated(
  ctx: PictureCtx,
  i: number,
  how: 'hidden' | 'removed',
): Promise<number> {
  const id = await seedPicture(ctx, i);
  if (how === 'removed') {
    await ctx.store.removeByProvenance(ctx.guildId, `${DEMO_DEATH_PREFIX}${i}`);
  } else {
    await ctx.db
      .update(schema.hubMedia)
      .set({ hiddenAt: ctx.now })
      .where(eq(schema.hubMedia.id, id));
  }
  return id;
}

/** The optional hidden + removed pictures, older than the visible ones. */
async function seedModeratedPictures(
  ctx: PictureCtx,
  count: number,
  want: { hidden: boolean; removed: boolean },
): Promise<Pick<DeathPicturesFixture, 'hiddenMediaId' | 'removedMediaId'>> {
  const hiddenMediaId = want.hidden
    ? await seedModerated(ctx, count, 'hidden')
    : null;
  const removedMediaId = want.removed
    ? await seedModerated(ctx, count + 1, 'removed')
    : null;
  return { hiddenMediaId, removedMediaId };
}

/** Replace the worker's demo death pictures on its Deaths-fixture hub. */
export async function seedDeathPictures(
  db: Db,
  store: HubMediaService,
  input: DeathPicturesRequest & { serverId: number; guildId: number },
): Promise<DeathPicturesFixture> {
  const { serverId, guildId, worker, count } = input;
  await clearDemoDeathPictures(db, serverId, guildId);
  const character = topCharacter(worker);
  const ctx: PictureCtx = {
    db,
    store,
    serverId,
    guildId,
    character,
    now: new Date(),
  };
  const mediaIds: number[] = [];
  for (let i = 0; i < count; i += 1) mediaIds.push(await seedPicture(ctx, i));
  const moderated = await seedModeratedPictures(ctx, count, input);
  const users = await ensureDeathsUsers(db, worker, guildId);
  return {
    serverId,
    guildId,
    characterName: character.name,
    mediaIds,
    ...moderated,
    users,
  };
}

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { HUB_MEDIA_PAGE_MAX, type HubMediaKind } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type {
  HubMediaIngestInput,
  HubMediaSourceInput,
} from './hub-media.types';
import { solidPng } from './hub-media.testing';

/**
 * The Discord-sourced kinds the default seed cycles through. `upload` is
 * excluded: an upload row is `source: 'upload'` with an uploader (ROK-1965),
 * never a Discord-sourced picture, so the seed must not mint that hybrid.
 */
export const SEED_KINDS = [
  'death',
  'screenshot',
  'image',
] as const satisfies readonly HubMediaKind[];
type SeedKind = (typeof SEED_KINDS)[number];

const DISCORD_DEFAULT_COUNT = 14;
const SAVE_DEFAULT_COUNT = 2;

const BodySchema = z
  .object({
    guildId: z.number().int().positive(),
    count: z.number().int().min(1).max(HUB_MEDIA_PAGE_MAX).optional(),
    source: z.enum(['discord', 'bg3-save']).optional(),
    uploadedBy: z.number().int().positive().optional(),
  })
  .strict();

/**
 * `discord` (the default, unchanged): `count` ≥ 3 so every Discord kind is
 * present. `bg3-save` (ROK-1959): game-save pictures owned by `uploadedBy`.
 */
export type DemoSeedRequest =
  | { source: 'discord'; guildId: number; count: number }
  | { source: 'bg3-save'; guildId: number; count: number; uploadedBy: number };

export const DEMO_SEED_USAGE = `Expected { guildId, count?: ${SEED_KINDS.length}..${HUB_MEDIA_PAGE_MAX} } or { guildId, source: 'bg3-save', uploadedBy, count?: 1..${HUB_MEDIA_PAGE_MAX} }`;

/** The request, or null when the body is malformed (→ 400 with the usage). */
export function parseDemoSeedBody(body: unknown): DemoSeedRequest | null {
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) return null;
  const { guildId, count, source, uploadedBy } = parsed.data;
  if (source === 'bg3-save') {
    if (uploadedBy === undefined) return null;
    return {
      source,
      guildId,
      count: count ?? SAVE_DEFAULT_COUNT,
      uploadedBy,
    };
  }
  if (uploadedBy !== undefined) return null;
  const n = count ?? DISCORD_DEFAULT_COUNT;
  if (n < SEED_KINDS.length) return null;
  return { source: 'discord', guildId, count: n };
}

const CAPTIONS: Record<SeedKind, string> = {
  death: 'Died to a Troll',
  screenshot: 'Base at sunset',
  image: 'Map sketch',
};

/** One Discord-sourced picture, cycling death → screenshot → image, an hour apart. */
export function discordSeedInput(
  guildId: number,
  run: string,
  i: number,
): HubMediaIngestInput {
  const kind = SEED_KINDS[i % SEED_KINDS.length] ?? 'image';
  return {
    guildId,
    source: 'discord',
    kind,
    provenanceKey: `demo:${run}:${i}`,
    sourceUrl: `https://cdn.discordapp.com/attachments/demo/${run}/${i}.png`,
    authorName: `Viking ${(i % 5) + 1}`,
    caption: `${CAPTIONS[kind]} #${i + 1}`,
    capturedAt: new Date(Date.now() - i * 3_600_000),
    discord: null,
  };
}

export interface SeedUploader {
  id: number;
  name: string;
}

/** One game-save picture owned by `uploader` (so they can Remove it), an hour apart. */
export async function saveSeedInput(
  guildId: number,
  run: string,
  i: number,
  uploader: SeedUploader,
): Promise<HubMediaSourceInput> {
  return {
    guildId,
    source: 'bg3-save',
    kind: 'save',
    provenanceKey: `bg3-save:demo:${run}:${i}`,
    uploadedBy: uploader.id,
    authorName: uploader.name,
    caption: `Camp #${i + 1}`,
    capturedAt: new Date(Date.now() - i * 3_600_000),
    bytes: await solidPng(1280, 720, 40 + i),
  };
}

/** The uploader's id + shown name, or undefined when no such user exists. */
export async function findSeedUploader(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<SeedUploader | undefined> {
  const [row] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) return undefined;
  return { id: row.id, name: row.displayName ?? row.username };
}

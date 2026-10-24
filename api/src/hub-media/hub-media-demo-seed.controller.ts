import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import {
  HUB_MEDIA_KINDS,
  HUB_MEDIA_PAGE_MAX,
  type HubMediaKind,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from '../admin/demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { findHiddenAt } from '../guilds/hub-hidden.helpers';
import type { HubMediaDownloader } from './hub-media-download';
import { HubMediaService } from './hub-media.service';
import { solidPng } from './hub-media.testing';

const BodySchema = z
  .object({
    guildId: z.number().int().positive(),
    count: z
      .number()
      .int()
      .min(HUB_MEDIA_KINDS.length)
      .max(HUB_MEDIA_PAGE_MAX)
      .default(14),
  })
  .strict();

const CAPTIONS: Record<HubMediaKind, string> = {
  death: 'Died to a Troll',
  screenshot: 'Base at sunset',
  image: 'Map sketch',
};

/** Generated pictures, no network: the URL's last segment picks the colour + shape. */
const generated: HubMediaDownloader = {
  download(url: URL): Promise<Buffer> {
    const i = Number(url.pathname.split('/').pop()?.replace('.png', '') ?? 0);
    return i % 4 === 3 ? solidPng(720, 1280, i) : solidPng(1280, 720, i);
  },
};

/**
 * ROK-1942 L2 — DEMO_MODE `POST /admin/test/hub-media/seed { guildId, count }`:
 * `count` (≥ 3, default 14) generated pictures through the real `ingest`
 * (stub downloader), cycling death → screenshot → image so every kind is
 * present, one per hour back from now. Each call adds a fresh batch.
 */
@Controller('admin/test/hub-media')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class HubMediaDemoSeedController {
  private readonly store: HubMediaService;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    this.store = new HubMediaService(db, generated);
  }

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: unknown,
  ): Promise<{ guildId: number; ids: number[] }> {
    const parsed = BodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        `Expected { guildId, count?: ${HUB_MEDIA_KINDS.length}..${HUB_MEDIA_PAGE_MAX} }`,
      );
    }
    const { guildId, count } = parsed.data;
    if ((await findHiddenAt(this.db, guildId)) === undefined) {
      throw new NotFoundException('Guild not found');
    }
    const run = randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const result = await this.store.ingest(seedInput(guildId, run, i));
      if (result.status === 'stored') ids.push(result.mediaId);
    }
    return { guildId, ids };
  }
}

function seedInput(guildId: number, run: string, i: number) {
  const kind = HUB_MEDIA_KINDS[i % HUB_MEDIA_KINDS.length] ?? 'image';
  return {
    guildId,
    source: 'discord' as const,
    kind,
    provenanceKey: `demo:${run}:${i}`,
    sourceUrl: `https://cdn.discordapp.com/attachments/demo/${run}/${i}.png`,
    authorName: `Viking ${(i % 5) + 1}`,
    caption: `${CAPTIONS[kind]} #${i + 1}`,
    capturedAt: new Date(Date.now() - i * 3_600_000),
    discord: null,
  };
}

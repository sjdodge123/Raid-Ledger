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
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from '../admin/demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { findHiddenAt } from '../guilds/hub-hidden.helpers';
import type { HubMediaDownloader } from './hub-media-download';
import {
  DEMO_SEED_USAGE,
  type DemoSeedRequest,
  discordSeedInput,
  findSeedUploader,
  parseDemoSeedBody,
  saveSeedInput,
} from './hub-media-demo-seed.helpers';
import { HubMediaService } from './hub-media.service';
import { solidPng } from './hub-media.testing';

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
 * (stub downloader), cycling death → screenshot → image so every Discord
 * kind is present (never `upload` — ROK-1965), one per hour back from now.
 * ROK-1959 — `{ guildId, source: 'bg3-save', uploadedBy, count? }` instead
 * stores `count` (default 2) game-save pictures (`kind: 'save'`) owned by
 * `uploadedBy` through `ingestFromSource`; they list only while the owning
 * plugin is active. Each call adds a fresh batch.
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
    const req = parseDemoSeedBody(body);
    if (!req) throw new BadRequestException(DEMO_SEED_USAGE);
    if ((await findHiddenAt(this.db, req.guildId)) === undefined) {
      throw new NotFoundException('Guild not found');
    }
    const ids =
      req.source === 'bg3-save'
        ? await this.seedSaves(req)
        : await this.seedDiscord(req.guildId, req.count);
    return { guildId: req.guildId, ids };
  }

  private async seedDiscord(guildId: number, count: number): Promise<number[]> {
    const run = randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const result = await this.store.ingest(discordSeedInput(guildId, run, i));
      if (result.status === 'stored') ids.push(result.mediaId);
    }
    return ids;
  }

  private async seedSaves(
    req: Extract<DemoSeedRequest, { source: 'bg3-save' }>,
  ): Promise<number[]> {
    const uploader = await findSeedUploader(this.db, req.uploadedBy);
    if (!uploader) throw new NotFoundException('User not found');
    const run = randomUUID();
    const ids: number[] = [];
    for (let i = 0; i < req.count; i += 1) {
      const input = await saveSeedInput(req.guildId, run, i, uploader);
      const result = await this.store.ingestFromSource(input);
      if (result.status === 'stored') ids.push(result.mediaId);
    }
    return ids;
  }
}

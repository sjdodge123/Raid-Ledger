/**
 * ROK-2187 — serves the community GG mascot copies (emoji + soundboard
 * sound) at `/uploads/gg-mascot/{snowflake}-{ext}` — INTENTIONALLY
 * UNGUARDED, like the static mounts it replaces (anonymous `/w/:slug`
 * viewers see the mascot). The URL carries no file extension on purpose:
 * prod nginx's static-asset regex location (`\.(png|gif|…)$`) outranks
 * `location /api/` and would 404 an extension URL from its own disk.
 */
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getGgMascotDir, mascotFileFromToken } from './gg-mascot.storage';

/** Same 1-day cache the old static mount sent; URLs carry a content `?v=`. */
const CACHE_CONTROL = 'public, max-age=86400';

@Controller('uploads/gg-mascot')
export class GgMascotAssetController {
  /** One stored copy by URL token, with its sniffed Content-Type; 404 otherwise. */
  @Get(':asset')
  async asset(
    @Param('asset') asset: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = mascotFileFromToken(asset);
    if (!file) throw new NotFoundException();
    const buf = await fs.promises
      .readFile(path.join(getGgMascotDir(), file.name))
      .catch(() => null);
    if (!buf) throw new NotFoundException();
    res.setHeader('Cache-Control', CACHE_CONTROL);
    return new StreamableFile(buf, { type: file.contentType });
  }
}

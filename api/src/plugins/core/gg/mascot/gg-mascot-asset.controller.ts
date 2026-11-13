/**
 * ROK-2187 — serves the community GG mascot copies (emoji + soundboard
 * sound) at `/uploads/gg-mascot/{snowflake}-{ext}` — INTENTIONALLY
 * UNGUARDED, like the static mounts it replaces (anonymous `/w/:slug`
 * viewers see the mascot). The URL carries no file extension on purpose:
 * prod nginx's static-asset regex location (`\.(png|gif|…)$`) outranks
 * `location /api/` and would 404 an extension URL from its own disk.
 * Served with Express `sendFile`, which answers Range (206 — WebKit audio
 * asks for byte ranges), ETag and conditional 304s like the old static mount.
 */
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { getGgMascotDir, mascotFileFromToken } from './gg-mascot.storage';

/** Same 1-day cache the old static mount sent; URLs carry a content `?v=`. */
const CACHE_CONTROL = 'public, max-age=86400';

@Controller('uploads/gg-mascot')
export class GgMascotAssetController {
  /** One stored copy by URL token, with its allow-listed Content-Type; 404 otherwise. */
  @Get(':asset')
  asset(@Param('asset') asset: string, @Res() res: Response): Promise<void> {
    const file = mascotFileFromToken(asset);
    if (!file) throw new NotFoundException();
    const options = {
      root: getGgMascotDir(),
      dotfiles: 'deny' as const,
      headers: {
        'Content-Type': file.contentType,
        'Cache-Control': CACHE_CONTROL,
      },
    };
    return new Promise((resolve, reject) => {
      res.sendFile(file.name, options, (err?: Error) => {
        // Missing file → Nest's 404; an aborted client after headers → done.
        if (err && !res.headersSent) reject(new NotFoundException());
        else resolve();
      });
    });
  }
}

import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  type PipeTransform,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import {
  ValheimMapFogLayerSchema,
  type ValheimMapFogLayer,
} from '@raid-ledger/contract';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import {
  NoStoreByDefault,
  openBlob,
  sizeOf,
} from './valheim-armory-blob.controller';
import { ValheimArmoryMapBytesService } from './valheim-armory-map-bytes.service';

/** Content-addressed base map: never changes under its sha256 (D3). */
const BASE_MAP_CACHE = 'private, max-age=31536000, immutable';
/** Fog changes with every snapshot: revalidate via the ETag (D4). */
const FOG_CACHE = 'private, no-cache';
const MAP = 'plugins/valheim/armory/characters/:id/maps/:mapId';

/** `?layer=personal|shared` (default `personal`; 400 otherwise). */
export class FogLayerPipe implements PipeTransform<
  unknown,
  ValheimMapFogLayer
> {
  transform(value: unknown): ValheimMapFogLayer {
    if (value === undefined) return 'personal';
    const parsed = ValheimMapFogLayerSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid layer');
    return parsed.data;
  }
}

/**
 * ROK-1837 D3/D4 — member-only map bytes. Errors stay `no-store`
 * (interceptor); the cache policy is set only once the bytes are in hand.
 * A matching `If-None-Match` answers 304 via Express's `req.fresh`.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
@UseInterceptors(NoStoreByDefault)
export class ValheimArmoryMapBytesController {
  constructor(private readonly bytes: ValheimArmoryMapBytesService) {}

  /** GET — the base-map PNG; 404 `base_map_not_ready` until stored. */
  @Get(`${MAP}/base-map`)
  async baseMap(
    @Param('id', armoryIdPipe) id: number,
    @Param('mapId', armoryIdPipe) mapId: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const { sha256, absPath } = await this.bytes.baseMap(id, mapId);
    const file = await openBlob(absPath, 'base_map_not_ready');
    const size = await sizeOf(file);
    res.set({
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': BASE_MAP_CACHE,
      ETag: `"${sha256}"`,
    });
    if (req.fresh) {
      await file.close();
      return undefined;
    }
    return new StreamableFile(file.createReadStream(), {
      type: 'image/png',
      length: size,
    });
  }

  /** GET — one fog layer's stored gzip bytes; 404 `no_shared_layer`. */
  @Get(`${MAP}/fog`)
  async fog(
    @Param('id', armoryIdPipe) id: number,
    @Param('mapId', armoryIdPipe) mapId: number,
    @Query('layer', new FogLayerPipe()) layer: ValheimMapFogLayer,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const { bytes, etag } = await this.bytes.fog(id, mapId, layer);
    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': FOG_CACHE,
      ETag: etag,
    });
    if (req.fresh) return undefined;
    return new StreamableFile(bytes, {
      type: 'application/octet-stream',
      length: bytes.length,
    });
  }
}

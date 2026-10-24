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
import type { Response } from 'express';
import {
  ValheimMapFogLayerSchema,
  type ValheimMapFogLayer,
} from '@raid-ledger/contract';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { NoStoreByDefault } from './valheim-armory-blob.controller';
import { ValheimArmoryMapBytesService } from './valheim-armory-map-bytes.service';

/**
 * The base-map URL is keyed by map id, and its bytes are masked per viewer
 * (ROK-1949), so it revalidates via the mask ETag and varies by viewer.
 */
const BASE_MAP_CACHE = 'private, no-cache';
/** Fog changes with every snapshot: revalidate via the ETag (D4). */
const FOG_CACHE = 'private, no-cache';
const MAP = 'plugins/valheim/armory/characters/:id/maps/:mapId';

/** Success headers for the base-map PNG (200 or 304 only). */
function baseMapHeaders(etag: string): Record<string, string> {
  return {
    'Content-Type': 'image/png',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': BASE_MAP_CACHE,
    Vary: 'Authorization',
    ETag: etag,
  };
}

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

  /** GET — the viewer-masked base-map PNG; 404 `base_map_not_ready` otherwise. */
  @Get(`${MAP}/base-map`)
  async baseMap(
    @Param('id', armoryIdPipe) id: number,
    @Param('mapId', armoryIdPipe) mapId: number,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const masked = await this.bytes.baseMap(id, mapId, req.user);
    // `req.fresh` compares against the response ETag, so set it to ask —
    // a 304 is answered from the inputs' fingerprint, nothing is rendered.
    res.set('ETag', masked.etag);
    if (req.fresh) {
      res.set(baseMapHeaders(masked.etag));
      return undefined;
    }
    // Until the masked bytes are in hand a failure stays no-store, no ETag.
    res.removeHeader('ETag');
    const png = await masked.bytes();
    res.set(baseMapHeaders(masked.etag));
    return new StreamableFile(png, { type: 'image/png', length: png.length });
  }

  /** GET — one fog layer's stored gzip bytes; 404 `no_<layer>_layer`. */
  @Get(`${MAP}/fog`)
  async fog(
    @Param('id', armoryIdPipe) id: number,
    @Param('mapId', armoryIdPipe) mapId: number,
    @Query('layer', new FogLayerPipe()) layer: ValheimMapFogLayer,
    @Req() req: AuthenticatedExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const { bytes, etag } = await this.bytes.fog(id, mapId, layer, req.user);
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

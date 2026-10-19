import { open, type FileHandle } from 'node:fs/promises';
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
  type PipeTransform,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ValheimSha256Schema } from '@raid-ledger/contract';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { ValheimArmoryReadService } from './valheim-armory-read.service';

/** Content-addressed bytes never change under a sha256. */
const BLOB_CACHE = 'private, max-age=31536000, immutable';

/** Lowercase-hex sha256 path param (400 otherwise). */
class Sha256Pipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const parsed = ValheimSha256Schema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid sha256');
    return parsed.data;
  }
}

async function openBlob(absPath: string): Promise<FileHandle> {
  try {
    return await open(absPath, 'r');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') throw new NotFoundException('Blob not found');
    throw err;
  }
}

/**
 * ROK-1836 D5 — member-only PNG bytes for an icon atlas, file icon or base
 * map. Located by `(server, sha256)` → `valheim_link_blobs.storage_path`
 * alone (R6: names never become paths); 404 when absent or not on disk.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimArmoryBlobController {
  constructor(private readonly reads: ValheimArmoryReadService) {}

  /** GET — `image/png` bytes, immutable private cache. */
  @Get('plugins/valheim/armory/servers/:serverId/blobs/:sha256')
  @Header('Content-Type', 'image/png')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', BLOB_CACHE)
  async blob(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Param('sha256', new Sha256Pipe()) sha256: string,
  ): Promise<StreamableFile> {
    const file = await openBlob(await this.reads.blobPath(serverId, sha256));
    const { size } = await file.stat();
    return new StreamableFile(file.createReadStream(), {
      type: 'image/png',
      length: size,
    });
  }
}

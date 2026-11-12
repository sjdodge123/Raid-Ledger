import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  GgMascotSelectDtoSchema,
  type GgMascot,
  type GgMascotOptionsDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../../auth/admin.guard';
import { GgMascotOptionsService } from './gg-mascot-options.service';
import { GgMascotService } from './gg-mascot.service';
import { MASCOT_CONTENT_TYPES } from './gg-mascot.storage';

const SNOWFLAKE = /^\d{1,25}$/;

/** ROK-2187 — admin GG mascot picker: options, save/remove, sound preview. */
@Controller('admin/gg/mascot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class GgMascotController {
  constructor(
    private readonly mascot: GgMascotService,
    private readonly options: GgMascotOptionsService,
  ) {}

  /** Current mascot (`null` = none). */
  @Get()
  current(): Promise<GgMascot | null> {
    return this.mascot.current();
  }

  /** The guild's emojis + sounds (cached 60 s; 503 bot offline; 429 rate limited). */
  @Get('options')
  getOptions(): Promise<GgMascotOptionsDto> {
    return this.options.getOptions();
  }

  /** Save (copies both assets) or remove (`emojiId: null`). Re-save = re-sync. */
  @Patch()
  select(@Body() body: unknown): Promise<GgMascot | null> {
    const parsed = GgMascotSelectDtoSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.mascot.select(parsed.data);
  }

  /** Streams a guild soundboard sound for the picker's ▶ (same-origin). */
  @Get('sounds/:id/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async preview(@Param('id') id: string): Promise<StreamableFile> {
    if (!SNOWFLAKE.test(id)) throw new BadRequestException('Bad sound id');
    const asset = await this.mascot.previewSound(id);
    return new StreamableFile(asset.buf, {
      type: MASCOT_CONTENT_TYPES[asset.ext],
      length: asset.buf.length,
    });
  }
}

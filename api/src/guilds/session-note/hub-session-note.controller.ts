import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { HubSessionNoteResponse } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { GuildEditorGuard } from '../guild-editor.guard';
import { HubKindActiveGuard } from '../hub-kind-active.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { HubSessionNoteService } from './hub-session-note.service';

const jwt = AuthGuard('jwt');
const NO_STORE = 'private, no-store';

/**
 * ROK-1968 §5.2 — the hub's "Before next session" note, every hub kind.
 * Read + tick: members (404 otherwise). Save + clear: editors only.
 */
@Controller('guilds/:id/session-note')
@UseGuards(HubKindActiveGuard)
export class HubSessionNoteController {
  constructor(private readonly notes: HubSessionNoteService) {}

  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HubSessionNoteResponse> {
    return this.notes.get(req.user, id);
  }

  @Put()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @Header('Cache-Control', NO_STORE)
  save(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<HubSessionNoteResponse> {
    return this.notes.save(req.user, id, body);
  }

  @Delete()
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @HttpCode(204)
  clear(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.notes.clear(id);
  }

  @Patch('items/:itemId')
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  tick(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() body: unknown,
  ): Promise<HubSessionNoteResponse> {
    return this.notes.tick(req.user, id, itemId, body);
  }
}

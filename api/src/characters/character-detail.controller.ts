import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CharactersService } from './characters.service';
import type { CharacterDto } from '@raid-ledger/contract';

/**
 * Public controller for character detail (equipment page).
 * No auth required — character data is public.
 */
@Controller('characters')
export class CharacterDetailController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get(':id')
  async getCharacter(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CharacterDto> {
    return this.charactersService.findOnePublic(id);
  }
}

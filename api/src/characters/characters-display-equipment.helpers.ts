import type { Logger } from '@nestjs/common';
import type { CharacterDto } from '@raid-ledger/contract';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';

/**
 * ROK-1727 (D1): let the variant's plugin substitute displayed gear.
 * Best-effort — a hook failure (snapshot / item-meta query) logs a warning
 * and returns the stored DTO, so the character page never 500s on it.
 */
export async function withDisplayEquipment(
  dto: CharacterDto,
  adapter: CharacterSyncAdapter | undefined,
  logger: Pick<Logger, 'warn'>,
): Promise<CharacterDto> {
  try {
    const equipment = await adapter?.resolveDisplayEquipment?.({
      id: dto.id,
      gameVariant: dto.gameVariant ?? null,
      equipment: dto.equipment ?? null,
    });
    return equipment === undefined ? dto : { ...dto, equipment };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Display equipment for character ${dto.id} failed: ${msg}`);
    return dto;
  }
}

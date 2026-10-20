/** ROK-1831 — the admin Community hub switch's pure helpers. */
import type { PelicanServerRowDto } from '@raid-ledger/contract';

export const HUB_NO_GAME_HINT = 'Map a game first';

/** On = the server has a hub that is not hidden. */
export function hubOn(row: PelicanServerRowDto): boolean {
    return row.communityHub != null && !row.communityHub.hidden;
}

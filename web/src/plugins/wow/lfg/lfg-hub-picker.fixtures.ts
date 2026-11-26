/** ROK-2352 — test fixtures for the WoW LFG hub picker (hubs + game registry rows). */
import type { GameRegistryDto, MyGuild } from '@raid-ledger/contract';

/** A game registry row with only the fields the picker reads varying. */
export function registryGame(id: number, slug: string, name: string, shortName: string | null = null): GameRegistryDto {
    return {
        id, slug, name, shortName, coverUrl: null, colorHex: null, hasRoles: true, hasSpecs: true,
        enabled: true, maxCharactersPerUser: 10, genres: [],
    };
}

/** One of the viewer's hubs; `gameSlug` omitted unless given (as `GET /guilds/mine` sends it). */
export function myHub(id: number, name: string, gameId: number, gameSlug?: string): MyGuild {
    return {
        id, gameId, kind: 'wow_guild', name, region: 'us', realmSlug: null, realmName: null, faction: null,
        memberCount: 3, lastSnapshotAt: null, rankIndex: null, rankName: null, canEdit: false,
        gmPostHeadline: null, ...(gameSlug === undefined ? {} : { gameSlug }),
    };
}

export const FOREVER = registryGame(1, 'world-of-warcraft-forever', 'World of Warcraft: Forever', 'WoW: Forever');
export const CLASSIC = registryGame(2, 'world-of-warcraft-classic', 'World of Warcraft Classic');
export const VALHEIM = registryGame(3, 'valheim', 'Valheim');
export const REGISTRY: GameRegistryDto[] = [FOREVER, CLASSIC, VALHEIM];

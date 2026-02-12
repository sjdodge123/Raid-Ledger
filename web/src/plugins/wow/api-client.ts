import type {
    CharacterDto,
    ImportWowCharacterInput,
    RefreshCharacterInput,
    WowRealmListResponseDto,
    BlizzardCharacterPreviewDto,
    WowInstanceListResponseDto,
    WowInstanceDetailDto,
} from '@raid-ledger/contract';
import { CharacterSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';

/**
 * Import a WoW character from Blizzard Armory (ROK-234)
 */
export async function importWowCharacter(dto: ImportWowCharacterInput): Promise<CharacterDto> {
    return fetchApi(
        '/users/me/characters/import/wow',
        {
            method: 'POST',
            body: JSON.stringify(dto),
        },
        CharacterSchema
    );
}

/**
 * Refresh a character's data from Blizzard Armory (ROK-234)
 */
export async function refreshCharacterFromArmory(
    characterId: string,
    dto: RefreshCharacterInput
): Promise<CharacterDto> {
    return fetchApi(
        `/users/me/characters/${characterId}/refresh`,
        {
            method: 'POST',
            body: JSON.stringify(dto),
        },
        CharacterSchema
    );
}

/**
 * Fetch WoW realm list for autocomplete (ROK-234 UX)
 */
export async function fetchWowRealms(
    region: string,
    gameVariant?: string,
): Promise<WowRealmListResponseDto> {
    const params = new URLSearchParams({ region });
    if (gameVariant) params.set('gameVariant', gameVariant);
    return fetchApi(`/blizzard/realms?${params}`);
}

/**
 * Preview a WoW character from Blizzard without saving (ROK-234 UX)
 */
export async function previewWowCharacter(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string,
): Promise<BlizzardCharacterPreviewDto> {
    const params = new URLSearchParams({ name, realm, region });
    if (gameVariant) params.set('gameVariant', gameVariant);
    return fetchApi(`/blizzard/character-preview?${params}`);
}

/**
 * Fetch WoW dungeon/raid instances for content selection
 */
export async function fetchWowInstances(
    gameVariant: string,
    type: 'dungeon' | 'raid',
): Promise<WowInstanceListResponseDto> {
    const params = new URLSearchParams({ gameVariant, type });
    return fetchApi(`/blizzard/instances?${params}`);
}

/**
 * Fetch detail for a specific WoW instance (level requirements, player count)
 */
export async function fetchWowInstanceDetail(
    instanceId: number,
    gameVariant: string,
): Promise<WowInstanceDetailDto> {
    const params = new URLSearchParams({ gameVariant });
    return fetchApi(`/blizzard/instance/${instanceId}?${params}`);
}

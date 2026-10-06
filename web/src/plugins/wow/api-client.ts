import type {
    CharacterDto,
    ImportWowCharacterInput,
    RefreshCharacterInput,
    WowRealmListResponseDto,
    BlizzardCharacterPreviewDto,
    WowInstanceListResponseDto,
    WowInstanceDetailDto,
    EnrichedDungeonQuestsResponse,
    QuestProgressResponse,
    QuestProgressDto,
    QuestCoverageResponse,
    UpdateQuestProgressBody,
    BossEncounterDto,
    BossLootDto,
    BlizzardCapabilitiesDto,
    WowForeverConfigDto,
    WowForeverConfigResponseDto,
} from '@raid-ledger/contract';
import { CharacterSchema, BlizzardCapabilitiesSchema, WowForeverConfigResponseSchema } from '@raid-ledger/contract';
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

/**
 * Fetch enriched quests for a dungeon instance (ROK-246)
 */
export async function fetchEnrichedQuests(
    instanceId: number,
    variant: string,
): Promise<EnrichedDungeonQuestsResponse> {
    const params = new URLSearchParams({ variant });
    return fetchApi(`/plugins/wow-classic/instances/${instanceId}/quests/enriched?${params}`);
}

/**
 * Fetch quest progress for all players on an event (ROK-246)
 */
export async function fetchQuestProgress(
    eventId: number,
): Promise<QuestProgressResponse> {
    return fetchApi(`/plugins/wow-classic/events/${eventId}/quest-progress`);
}

/**
 * Fetch sharable quest coverage for an event (ROK-246)
 */
export async function fetchQuestCoverage(
    eventId: number,
): Promise<QuestCoverageResponse> {
    return fetchApi(`/plugins/wow-classic/events/${eventId}/quest-coverage`);
}

/**
 * Update quest progress for the current user (ROK-246)
 */
export async function updateQuestProgress(
    eventId: number,
    body: UpdateQuestProgressBody,
): Promise<QuestProgressDto> {
    return fetchApi(`/plugins/wow-classic/events/${eventId}/quest-progress`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}

/**
 * Fetch boss encounters for an instance (ROK-247)
 */
export async function fetchBossesForInstance(
    instanceId: number,
    variant: string,
): Promise<BossEncounterDto[]> {
    const params = new URLSearchParams({ variant });
    return fetchApi(`/plugins/wow-classic/instances/${instanceId}/bosses?${params}`);
}

/**
 * Fetch loot table for a boss (ROK-247)
 */
export async function fetchLootForBoss(
    bossId: number,
    variant: string,
): Promise<BossLootDto[]> {
    const params = new URLSearchParams({ variant });
    return fetchApi(`/plugins/wow-classic/bosses/${bossId}/loot?${params}`);
}

/**
 * Runtime Blizzard capabilities — whether the Armory can import WoW Forever
 * characters (ROK-1717). Public, plugin-gated route.
 */
export async function fetchBlizzardCapabilities(): Promise<BlizzardCapabilitiesDto> {
    return fetchApi('/blizzard/capabilities', {}, BlizzardCapabilitiesSchema);
}

/** Admin: the WoW Forever namespace prefix + Armory-import flag (ROK-1717). */
export async function fetchForeverConfig(): Promise<WowForeverConfigResponseDto> {
    return fetchApi('/admin/plugins/blizzard/forever', {}, WowForeverConfigResponseSchema);
}

/** Admin: save the WoW Forever namespace prefix + Armory-import flag (ROK-1717). */
export async function updateForeverConfig(dto: WowForeverConfigDto): Promise<WowForeverConfigResponseDto> {
    return fetchApi('/admin/plugins/blizzard/forever', { method: 'PUT', body: JSON.stringify(dto) }, WowForeverConfigResponseSchema);
}

import type {
    CharacterListResponseDto,
    CreateCharacterDto,
    UpdateCharacterDto,
    CharacterDto,
} from '@raid-ledger/contract';
import {
    CharacterListResponseSchema,
    CharacterSchema,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch current user's characters, optionally filtered by game */
export async function getMyCharacters(
    gameId?: number,
): Promise<CharacterListResponseDto> {
    const params = gameId ? `?gameId=${gameId}` : '';
    return fetchApi(
        `/users/me/characters${params}`,
        {},
        CharacterListResponseSchema,
    );
}

/** Create a new character */
export async function createCharacter(
    dto: CreateCharacterDto,
): Promise<CharacterDto> {
    return fetchApi(
        '/users/me/characters',
        { method: 'POST', body: JSON.stringify(dto) },
        CharacterSchema,
    );
}

/** Update a character */
export async function updateCharacter(
    characterId: string,
    dto: UpdateCharacterDto,
): Promise<CharacterDto> {
    return fetchApi(
        `/users/me/characters/${characterId}`,
        { method: 'PATCH', body: JSON.stringify(dto) },
        CharacterSchema,
    );
}

/** Set a character as main */
export async function setMainCharacter(
    characterId: string,
): Promise<CharacterDto> {
    return fetchApi(
        `/users/me/characters/${characterId}/set-main`,
        { method: 'PATCH' },
        CharacterSchema,
    );
}

/** Delete a character */
export async function deleteCharacter(
    characterId: string,
): Promise<void> {
    return fetchApi(`/users/me/characters/${characterId}`, {
        method: 'DELETE',
    });
}

/**
 * Fetch a user's characters, optionally filtered by game (ROK-461).
 * Used by admin roster assignment.
 */
export async function getUserCharacters(
    userId: number,
    gameId?: number,
): Promise<CharacterDto[]> {
    const params = gameId ? `?gameId=${gameId}` : '';
    const result = await fetchApi<{ data: CharacterDto[] }>(
        `/users/${userId}/characters${params}`,
    );
    return result.data;
}

/** Fetch a single character by ID (public) */
export async function getCharacterDetail(
    characterId: string,
): Promise<CharacterDto> {
    return fetchApi(`/characters/${characterId}`, {}, CharacterSchema);
}

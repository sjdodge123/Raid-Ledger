import type {
    GameTimeResponse,
    GameTimeTemplateInput,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/**
 * Fetch current user's game time (composite view).
 * Automatically sends browser timezone offset.
 */
export async function getMyGameTime(
    week?: string,
    tzOffsetOverride?: number,
): Promise<GameTimeResponse> {
    const sp = new URLSearchParams();
    if (week) sp.set('week', week);
    sp.set(
        'tzOffset',
        String(tzOffsetOverride ?? new Date().getTimezoneOffset()),
    );
    const query = sp.toString();
    const response = await fetchApi<{ data: GameTimeResponse }>(
        `/users/me/game-time?${query}`,
        { cache: 'no-cache' },
    );
    return response.data;
}

/** Save current user's game time template */
export async function saveMyGameTime(
    slots: GameTimeTemplateInput['slots'],
): Promise<GameTimeResponse> {
    const response = await fetchApi<{ data: GameTimeResponse }>(
        '/users/me/game-time',
        { method: 'PUT', body: JSON.stringify({ slots }) },
    );
    return response.data;
}

/** Save per-hour date-specific overrides */
export async function saveMyGameTimeOverrides(
    overrides: Array<{
        date: string;
        hour: number;
        status: string;
    }>,
): Promise<void> {
    await fetchApi('/users/me/game-time/overrides', {
        method: 'PUT',
        body: JSON.stringify({ overrides }),
    });
}

/** Absence shape returned from the API */
interface AbsenceRecord {
    id: number;
    startDate: string;
    endDate: string;
    reason: string | null;
}

/** Create an absence range */
export async function createGameTimeAbsence(
    input: {
        startDate: string;
        endDate: string;
        reason?: string;
    },
): Promise<AbsenceRecord> {
    const response = await fetchApi<{ data: AbsenceRecord }>(
        '/users/me/game-time/absences',
        { method: 'POST', body: JSON.stringify(input) },
    );
    return response.data;
}

/** Delete an absence */
export async function deleteGameTimeAbsence(
    id: number,
): Promise<void> {
    await fetchApi(`/users/me/game-time/absences/${id}`, {
        method: 'DELETE',
    });
}

/** List all absences for current user */
export async function getGameTimeAbsences(): Promise<AbsenceRecord[]> {
    const response = await fetchApi<{ data: AbsenceRecord[] }>(
        '/users/me/game-time/absences',
    );
    return response.data;
}

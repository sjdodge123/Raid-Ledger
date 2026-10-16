/**
 * ROK-1767 (L3): per-game Discord @role admin hooks — the linked games, the
 * guild's roles for the picker, preflight, link/edit, unlink, "Run now" and a
 * game's audit trail. Mirrors `use-weekly-digest-settings.ts`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import type {
    DiscordRoleOptionDto,
    GameRoleAuditEntryDto,
    GameRolePreflightDto,
    GameRoleRunResultDto,
    GameRoleSummaryDto,
    UpsertGameRoleDto,
} from '@raid-ledger/contract';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';

const BASE = '/admin/settings/discord-bot';
const URL = `${BASE}/game-roles`;

/** Query key for the linked game roles. */
export const GAME_ROLES_KEY = ['admin', 'settings', 'discord-bot', 'game-roles'] as const;

export interface UpsertGameRoleVars { gameId: number; body: UpsertGameRoleDto }
export interface PreflightVars { gameId: number; roleId: string | null }

export interface GameRolesHook {
    list: UseQueryResult<GameRoleSummaryDto[]>;
    upsert: UseMutationResult<GameRoleSummaryDto, Error, UpsertGameRoleVars>;
    remove: UseMutationResult<void, Error, number>;
    run: UseMutationResult<GameRoleRunResultDto, Error, number | undefined>;
}

/** DELETE answers 204 with no body, which `adminFetch` would try to parse. */
async function deleteLink(gameId: number): Promise<void> {
    await adminFetch<unknown>(`${URL}/${gameId}`, { method: 'DELETE' }, 'Failed to unlink the game role')
        .catch((err: unknown) => { if (!(err instanceof SyntaxError)) throw err; });
}

/** Linked games plus the link/unlink/run mutations; each refreshes the list. */
export function useGameRoles(): GameRolesHook {
    const queryClient = useQueryClient();
    const refresh = () => queryClient.invalidateQueries({ queryKey: [...GAME_ROLES_KEY] });

    const list = useQuery<GameRoleSummaryDto[]>({
        queryKey: [...GAME_ROLES_KEY],
        queryFn: () => adminFetch(URL),
        enabled: !!getAuthToken(),
    });
    const upsert = useMutation<GameRoleSummaryDto, Error, UpsertGameRoleVars>({
        mutationFn: ({ gameId, body }) =>
            adminFetch(`${URL}/${gameId}`, { method: 'PUT', body: JSON.stringify(body) }, 'Failed to save the game role'),
        onSuccess: refresh,
    });
    const remove = useMutation<void, Error, number>({ mutationFn: deleteLink, onSuccess: refresh });
    const run = useMutation<GameRoleRunResultDto, Error, number | undefined>({
        mutationFn: (gameId) => adminFetch(`${URL}/run${gameId === undefined ? '' : `?gameId=${gameId}`}`,
            { method: 'POST' }, 'Failed to run the game role sync'),
        onSuccess: refresh,
    });
    return { list, upsert, remove, run };
}

/** The guild's roles for the picker (highest first; no @everyone or managed roles). */
export function useDiscordRoleOptions(enabled: boolean): UseQueryResult<DiscordRoleOptionDto[]> {
    return useQuery<DiscordRoleOptionDto[]>({
        queryKey: [...GAME_ROLES_KEY, 'roles'],
        queryFn: () => adminFetch(`${BASE}/roles`),
        enabled: enabled && !!getAuthToken(),
        staleTime: 30_000,
    });
}

/** Preflight for a game + role choice; `roleId: null` checks the bot can create one. */
export function useGameRolePreflight(vars: PreflightVars | null): UseQueryResult<GameRolePreflightDto> {
    return useQuery<GameRolePreflightDto>({
        queryKey: [...GAME_ROLES_KEY, 'preflight', vars?.gameId ?? null, vars?.roleId ?? null],
        queryFn: () => adminFetch(`${URL}/${vars?.gameId ?? 0}/preflight`,
            { method: 'POST', body: JSON.stringify({ roleId: vars?.roleId ?? null }) }, 'Preflight failed'),
        enabled: vars !== null && !!getAuthToken(),
    });
}

/** The last 20 role changes for one game. */
export function useGameRoleAudit(gameId: number, enabled: boolean): UseQueryResult<GameRoleAuditEntryDto[]> {
    return useQuery<GameRoleAuditEntryDto[]>({
        queryKey: [...GAME_ROLES_KEY, 'audit', gameId],
        queryFn: () => adminFetch(`${URL}/${gameId}/audit?limit=20`),
        enabled: enabled && !!getAuthToken(),
    });
}

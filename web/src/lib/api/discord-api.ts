import type {
    CreatePugSlotDto,
    UpdatePugSlotDto,
    PugSlotResponseDto,
    PugSlotListResponseDto,
    InviteCodeResolveResponseDto,
    ShareEventResponseDto,
    PugRole,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

// -- PUG Slots (ROK-262) --

/** List PUG slots for an event */
export async function getEventPugs(
    eventId: number,
): Promise<PugSlotListResponseDto> {
    return fetchApi(`/events/${eventId}/pugs`);
}

/** Add a PUG slot to an event */
export async function createPugSlot(
    eventId: number,
    dto: CreatePugSlotDto,
): Promise<PugSlotResponseDto> {
    return fetchApi(`/events/${eventId}/pugs`, {
        method: 'POST',
        body: JSON.stringify(dto),
    });
}

/** Update a PUG slot */
export async function updatePugSlot(
    eventId: number,
    pugId: string,
    dto: UpdatePugSlotDto,
): Promise<PugSlotResponseDto> {
    return fetchApi(`/events/${eventId}/pugs/${pugId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    });
}

/** Remove a PUG slot */
export async function deletePugSlot(
    eventId: number,
    pugId: string,
): Promise<void> {
    return fetchApi(`/events/${eventId}/pugs/${pugId}`, {
        method: 'DELETE',
    });
}

/** Invite a registered member to an event */
export async function inviteMember(
    eventId: number,
    discordId: string,
): Promise<{ message: string }> {
    return fetchApi(`/events/${eventId}/invite-member`, {
        method: 'POST',
        body: JSON.stringify({ discordId }),
    });
}

// -- Discord Member Search (ROK-292) --

export interface DiscordMemberSearchResult {
    discordId: string;
    username: string;
    avatar: string | null;
    isRegistered?: boolean;
}

/** List Discord server members */
export async function listDiscordMembers(): Promise<
    DiscordMemberSearchResult[]
> {
    return fetchApi('/discord/members/list');
}

/** Search Discord server members by username query */
export async function searchDiscordMembers(
    query: string,
): Promise<DiscordMemberSearchResult[]> {
    return fetchApi(
        `/discord/members/search?q=${encodeURIComponent(query)}`,
    );
}

// -- Invite Code (ROK-263) --

/** Resolve an invite code (public, no auth) */
export async function resolveInviteCode(
    code: string,
): Promise<InviteCodeResolveResponseDto> {
    return fetchApi(`/invite/${code}`);
}

/** Claim an invite code (requires auth, ROK-394) */
export async function claimInviteCode(
    code: string,
    role?: PugRole,
    characterId?: string,
): Promise<{
    type: 'signup' | 'claimed';
    eventId: number;
    discordServerInviteUrl?: string;
}> {
    const body: Record<string, unknown> = {};
    if (role) body.role = role;
    if (characterId) body.characterId = characterId;
    return fetchApi(`/invite/${code}/claim`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/** Share an event to bound Discord channels */
export async function shareEventToDiscord(
    eventId: number,
): Promise<ShareEventResponseDto> {
    return fetchApi(`/events/${eventId}/share`, { method: 'POST' });
}

/** Regenerate invite code for a PUG slot */
export async function regeneratePugInviteCode(
    eventId: number,
    pugId: string,
): Promise<PugSlotResponseDto> {
    return fetchApi(
        `/events/${eventId}/pugs/${pugId}/regenerate-code`,
        { method: 'POST' },
    );
}

/**
 * ROK-2149 — where `CharacterDetailPage` gets its character from: a real
 * character (`/characters/:id`) or a hub roster member with no character
 * (`/hubs/:id/members/:memberId`, read-only). The page stays one component;
 * this only picks the query and normalises the member payload to a
 * `CharacterDto` the header and sections already render.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import { CharacterSchema, type CharacterDto, type RosterMemberNoArmoryReason, type WowRosterMemberCharacterDto, type WowRosterMemberResponseDto } from '@raid-ledger/contract';
import { useCharacterDetail } from '../hooks/use-character-detail';
import { useRosterMemberCharacter } from '../hooks/use-roster-member-character';
import { httpStatusOf } from '../lib/api/api-error';

/** What read-only mode needs beyond the `CharacterDto`. */
export interface ReadOnlyCharacterMeta {
    hubId: number;
    rosterMemberId: number;
    canClaim: boolean;
    noArmoryReason: RosterMemberNoArmoryReason | null;
    /** Roster-only facts (rank, last seen) — empty for the claim-preview audience. */
    facts: string[];
    /** Opened from a claim list (`?from=claim`): the CTA reads as a confirm step. */
    fromClaim: boolean;
}

export type CharacterPageSource =
    | { kind: 'loading' }
    | { kind: 'error'; message: string; status: number | undefined; hubId: string | undefined }
    | { kind: 'redirect'; to: string }
    | { kind: 'ready'; character: CharacterDto; readOnly: ReadOnlyCharacterMeta | null };

/** "Online now" / "Last seen today" / "Last seen 3 days ago"; null when the export did not report it. */
export function lastSeenLabel(lastSeen: WowRosterMemberCharacterDto['lastSeen']): string | null {
    if (!lastSeen) return null;
    if (lastSeen.online) return 'Online now';
    const days = lastSeen.lastOnlineDays;
    if (days == null) return null;
    if (days <= 0) return 'Last seen today';
    return days === 1 ? 'Last seen yesterday' : `Last seen ${days} days ago`;
}

function rosterFacts(dto: WowRosterMemberCharacterDto): string[] {
    const facts: string[] = [];
    if (dto.rank?.name) facts.push(`Rank: ${dto.rank.name}`);
    const seen = lastSeenLabel(dto.lastSeen);
    if (seen) facts.push(seen);
    return facts;
}

/** The character keys only: Zod's default strip drops the read-only extras (rank, lastSeen, canClaim, …). */
const CharacterBaseSchema = CharacterSchema.omit({ id: true, userId: true });

/** The member payload as a `CharacterDto` (nobody owns it: `userId` -1) plus its read-only meta. */
export function toReadOnlyCharacter(dto: WowRosterMemberCharacterDto, fromClaim: boolean): { character: CharacterDto; readOnly: ReadOnlyCharacterMeta } {
    return {
        character: { ...CharacterBaseSchema.parse(dto), id: dto.id, userId: -1 },
        readOnly: {
            hubId: dto.hubId, rosterMemberId: dto.rosterMemberId, canClaim: dto.canClaim,
            noArmoryReason: dto.noArmoryReason ?? null, facts: rosterFacts(dto), fromClaim,
        },
    };
}

function fromMember(data: WowRosterMemberResponseDto, fromClaim: boolean): CharacterPageSource {
    if ('claimedCharacterId' in data) return { kind: 'redirect', to: `/characters/${data.claimedCharacterId}` };
    return { kind: 'ready', ...toReadOnlyCharacter(data, fromClaim) };
}

/** Picks the query by route: `:memberId` present = roster member (`:id` is then the hub id). */
export function useCharacterPageSource(): CharacterPageSource {
    const { id, memberId } = useParams<{ id: string; memberId: string }>();
    const [search] = useSearchParams();
    const character = useCharacterDetail(memberId ? undefined : id);
    const member = useRosterMemberCharacter(memberId ? id : undefined, memberId);
    const q = memberId ? member : character;
    if (q.isLoading) return { kind: 'loading' };
    if (q.error || !q.data) {
        const fallback = memberId ? 'Roster member not found' : 'Character not found';
        return { kind: 'error', message: q.error?.message ?? fallback, status: httpStatusOf(q.error), hubId: memberId ? id : undefined };
    }
    if (memberId && member.data) return fromMember(member.data, search.get('from') === 'claim');
    return character.data ? { kind: 'ready', character: character.data, readOnly: null } : { kind: 'loading' };
}

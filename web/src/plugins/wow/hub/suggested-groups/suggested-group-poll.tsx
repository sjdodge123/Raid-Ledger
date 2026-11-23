/**
 * ROK-2212 — Poll on a suggested group (ruling 5): the shared scheduling-poll
 * modal locked to the hub's game, tagged to the guild hub (F1 ruling
 * 2026-11-17: a poll may carry a `wow_guild` hub tag) and pre-filled with the
 * group's players — only the claimed ones, an unclaimed row has no user (F2).
 * Lazy like the hub Events tab's poll modal. ROK-2256: the claimed members'
 * character names label the picker's Selected chips.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { GuildPage, SuggestedGroupDto } from '@raid-ledger/contract';
import { pollMemberNames, pollMemberUserIds } from './suggested-groups-links';

const CreatePollModal = lazy(() => import('../../../../components/scheduling/create-poll-modal').then((m) => ({ default: m.CreatePollModal })));

interface Props {
    group: SuggestedGroupDto;
    page: { guild: Pick<GuildPage['guild'], 'id' | 'gameId' | 'name'> };
    onClose: () => void;
}

/** The modal for one group; mount it only while a group is picked. */
export function SuggestedGroupPollModal({ group, page, onClose }: Props): JSX.Element {
    return (
        <Suspense fallback={null}>
            <CreatePollModal isOpen onClose={onClose} initialGameId={page.guild.gameId} hubId={page.guild.id}
                hubName={page.guild.name} initialMemberUserIds={pollMemberUserIds(group)}
                initialMembers={pollMemberNames(group)} />
        </Suspense>
    );
}

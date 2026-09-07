/**
 * ROK-1455 — inviting a suggested player to an LFG group.
 *
 * One mutation per panel, keyed by recipient. The hook keeps the per-recipient
 * outcome (`sent` / `skipped`) so a row can flip to its final label the moment
 * the server answers, before the suggestions refetch confirms it, and holds
 * the group-cap message (a 429) at panel level — the cap is group-scoped, so
 * every row is affected, not the one that tripped it (D13).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
    LfgInviteOutcome,
    LfgInviteResponseDto,
} from '@raid-ledger/contract';
import { inviteToGroup, LfgInviteCapError } from '../lib/api/lfg-api';
import { toast } from '../lib/toast';
import { LFG_COPY } from '../pages/lfg/lfg-copy';
import { lfgSuggestionsKey } from './use-lfg-reads';

export interface InviteToGroup {
    /** Send the invite to one recipient. */
    invite: (userId: number) => void;
    /** The recipient whose invite is in flight, if any. */
    pendingUserId: number | null;
    /** The server's answer for a recipient invited in this session. */
    outcomeFor: (userId: number) => LfgInviteOutcome | undefined;
    /** Non-null once the group's daily budget is spent (429). */
    capMessage: string | null;
}

/** `POST /lfg/:gameId/invites` for one group, with per-row outcome state. */
export function useInviteToGroup(gameId: number): InviteToGroup {
    const queryClient = useQueryClient();
    const [outcomes, setOutcomes] = useState<Record<number, LfgInviteOutcome>>(
        {},
    );
    const [capMessage, setCapMessage] = useState<string | null>(null);

    const mutation = useMutation<LfgInviteResponseDto, Error, number>({
        mutationFn: (userId) => inviteToGroup(gameId, userId),
        onSuccess: (result, userId) => {
            setOutcomes((prev) => ({ ...prev, [userId]: result.status }));
            if (result.status === 'sent') {
                queryClient.invalidateQueries({
                    queryKey: lfgSuggestionsKey(gameId),
                });
            }
        },
        onError: (error) => {
            if (error instanceof LfgInviteCapError) {
                setCapMessage(error.message || LFG_COPY.inviteCapped);
                return;
            }
            toast.error(LFG_COPY.inviteFailed);
        },
    });

    return {
        invite: mutation.mutate,
        pendingUserId: mutation.isPending ? (mutation.variables ?? null) : null,
        outcomeFor: (userId) => outcomes[userId],
        capMessage,
    };
}

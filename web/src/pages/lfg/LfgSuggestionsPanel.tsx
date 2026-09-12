/**
 * ROK-1464 AC5 — "Might want in".
 *
 * Every row states WHY the player is here; the reasons come ranked
 * (played → owns → hearted) from `GET /lfg/:gameId/suggestions`, so the first
 * one is also the strongest and drives the subtitle.
 *
 * The Invite button (ROK-1455) DMs the player on the group's behalf. It goes
 * quiet, never absent: "Invited" while a live invite exists (D7 — a decline
 * collapses into it), "Not available" for every recipient-scoped refusal
 * (D13 — never the reason), and every row locks behind one inline message
 * once the group's daily budget is spent (429).
 */
import type { JSX } from 'react';
import type {
    LfgSuggestionDto,
    LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import {
    useInviteToGroup,
    type InviteToGroup,
} from '../../hooks/use-lfg-invite';
import { LFG_COPY, REASON_CHIP, REASON_SUBTITLE } from './lfg-copy';

export interface LfgSuggestionsPanelProps {
    gameId: number;
    suggestions: LfgSuggestionsResponseDto | undefined;
    isLoading?: boolean;
    /** The read failed (ROK-1535). Never rendered as an empty list. */
    isError?: boolean;
}

/** The ranked reason chips for one suggestion. Never empty — the DTO guarantees one. */
function ReasonChips({
    reasons,
}: {
    reasons: LfgSuggestionDto['reasons'];
}): JSX.Element {
    return (
        <>
            {reasons.map((reason) => (
                <span
                    key={reason}
                    className="rounded bg-faint px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
                >
                    {REASON_CHIP[reason]}
                </span>
            ))}
        </>
    );
}

/** What one row's button says, given the wire state and this session's answer. */
function inviteLabel(
    suggestion: LfgSuggestionDto,
    outcome: ReturnType<InviteToGroup['outcomeFor']>,
): string {
    if (suggestion.inviteState === 'sent' || outcome === 'sent') {
        return LFG_COPY.invited;
    }
    if (outcome === 'skipped') return LFG_COPY.inviteUnavailable;
    return LFG_COPY.invite;
}

/** The live invite. Disabled (never hidden) once it has nothing left to do. */
function InviteButton({
    suggestion,
    invite,
}: {
    suggestion: LfgSuggestionDto;
    invite: InviteToGroup;
}): JSX.Element {
    const label = inviteLabel(suggestion, invite.outcomeFor(suggestion.userId));
    const settled = label !== LFG_COPY.invite;
    const disabled =
        settled ||
        invite.pendingUserId === suggestion.userId ||
        invite.capMessage != null;
    return (
        <button
            type="button"
            disabled={disabled}
            data-testid="lfg-invite-button"
            onClick={() => invite.invite(suggestion.userId)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                settled
                    ? 'bg-overlay text-muted opacity-60'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50'
            }`}
        >
            {label}
        </button>
    );
}

/** One suggested player: who they are, why, and the invite. */
function SuggestionRow({
    suggestion,
    invite,
}: {
    suggestion: LfgSuggestionDto;
    invite: InviteToGroup;
}): JSX.Element {
    const name = suggestion.displayName ?? suggestion.username;
    return (
        <li className="flex items-center gap-3 rounded-lg bg-overlay px-3 py-2">
            <AvatarWithFallback
                avatarUrl={suggestion.avatarUrl}
                username={name}
                sizeClassName="w-8 h-8"
            />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">
                        {name}
                    </span>
                    <ReasonChips reasons={suggestion.reasons} />
                </div>
                <p className="text-xs text-muted">
                    {REASON_SUBTITLE[suggestion.reasons[0]]}
                </p>
            </div>
            <InviteButton suggestion={suggestion} invite={invite} />
        </li>
    );
}

/** The group-scoped 429 copy. Rendered above the rows, since every row is locked. */
function CapNotice({ message }: { message: string | null }): JSX.Element | null {
    if (message == null) return null;
    return (
        <p
            role="status"
            data-testid="lfg-invite-cap"
            className="mb-2 text-xs text-amber-400"
        >
            {message}
        </p>
    );
}

/**
 * The three no-rows states, in precedence order.
 *
 * ROK-1535 — `isError` is checked BEFORE `isEmpty` because a failed read also
 * arrives with zero rows: without this, every 429 / 401 / 500 / schema
 * rejection told the operator the community had nobody to suggest.
 */
function PanelState({
    isLoading,
    isError,
    isEmpty,
}: {
    isLoading: boolean | undefined;
    isError: boolean | undefined;
    isEmpty: boolean;
}): JSX.Element | null {
    if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
    if (isError) {
        return (
            <p
                role="status"
                data-testid="lfg-suggestions-error"
                className="text-sm text-amber-400"
            >
                {LFG_COPY.suggestionsFailed}
            </p>
        );
    }
    if (isEmpty) {
        return <p className="text-sm text-muted">{LFG_COPY.suggestionsEmpty}</p>;
    }
    return null;
}

/** The rows themselves, so the panel stays a statement of its states. */
function SuggestionList({
    rows,
    invite,
}: {
    rows: LfgSuggestionDto[];
    invite: InviteToGroup;
}): JSX.Element {
    return (
        <ul className="space-y-2">
            {rows.map((suggestion) => (
                <SuggestionRow
                    key={suggestion.userId}
                    suggestion={suggestion}
                    invite={invite}
                />
            ))}
        </ul>
    );
}

/** Suggestions panel — who else might want in on this group. */
export function LfgSuggestionsPanel({
    gameId,
    suggestions,
    isLoading,
    isError,
}: LfgSuggestionsPanelProps): JSX.Element {
    const rows = suggestions?.suggestions ?? [];
    const invite = useInviteToGroup(gameId);
    return (
        <section
            data-testid="lfg-suggestions-panel"
            className="rounded-xl bg-surface p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-foreground">
                {LFG_COPY.suggestionsTitle}
            </h2>
            <PanelState
                isLoading={isLoading}
                isError={isError}
                isEmpty={rows.length === 0}
            />
            <CapNotice message={invite.capMessage} />
            <SuggestionList rows={rows} invite={invite} />
        </section>
    );
}

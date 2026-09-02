/**
 * ROK-1464 AC5 — "Might want in".
 *
 * Every row states WHY the player is here; the reasons come ranked
 * (played → owns → hearted) from `GET /lfg/:gameId/suggestions`, so the first
 * one is also the strongest and drives the subtitle.
 *
 * The invite button is deliberately inert (D7): ROK-1455 owns the DM. A
 * disabled control with an explanatory title is honest about that; hiding it
 * would leave the row with no affordance at all.
 */
import type { JSX } from 'react';
import type {
    LfgSuggestionDto,
    LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { LFG_COPY, REASON_CHIP, REASON_SUBTITLE } from './lfg-copy';

export interface LfgSuggestionsPanelProps {
    suggestions: LfgSuggestionsResponseDto | undefined;
    isLoading?: boolean;
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
                    className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200"
                >
                    {REASON_CHIP[reason]}
                </span>
            ))}
        </>
    );
}

/** The inert ROK-1455 placeholder. Disabled, never hidden — see the file header. */
function InvitePlaceholder(): JSX.Element {
    return (
        <button
            type="button"
            disabled
            data-testid="lfg-invite-placeholder"
            title={LFG_COPY.inviteDisabledTitle}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-overlay text-muted opacity-60"
        >
            {LFG_COPY.invite}
        </button>
    );
}

/** One suggested player: who they are, why, and the (inert) invite. */
function SuggestionRow({
    suggestion,
}: {
    suggestion: LfgSuggestionDto;
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
                    <span className="text-sm font-medium text-zinc-100">
                        {name}
                    </span>
                    <ReasonChips reasons={suggestion.reasons} />
                </div>
                <p className="text-xs text-muted">
                    {REASON_SUBTITLE[suggestion.reasons[0]]}
                </p>
            </div>
            <InvitePlaceholder />
        </li>
    );
}

/** Suggestions panel — who else might want in on this group. */
export function LfgSuggestionsPanel({
    suggestions,
    isLoading,
}: LfgSuggestionsPanelProps): JSX.Element {
    const rows = suggestions?.suggestions ?? [];
    return (
        <section
            data-testid="lfg-suggestions-panel"
            className="rounded-xl bg-surface p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">
                {LFG_COPY.suggestionsTitle}
            </h2>
            {isLoading && <p className="text-sm text-muted">Loading…</p>}
            {!isLoading && rows.length === 0 && (
                <p className="text-sm text-muted">
                    {LFG_COPY.suggestionsEmpty}
                </p>
            )}
            <ul className="space-y-2">
                {rows.map((suggestion) => (
                    <SuggestionRow
                        key={suggestion.userId}
                        suggestion={suggestion}
                    />
                ))}
            </ul>
        </section>
    );
}

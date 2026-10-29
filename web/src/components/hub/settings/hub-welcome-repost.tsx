/**
 * ROK-1933 part 4 — "Re-post welcome message", beside the channel picker in
 * the settings sheet's Discord section. The route edits the pinned welcome in
 * place or posts a fresh one; its answer, a pin warning (§4.7 `warning`) or a
 * refusal (§4.7 `danger`) shows inline under the button — never a toast.
 */
import type { JSX } from 'react';
import type { HubWelcomeResult } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useRepostHubWelcome } from '../discord/use-guild-discord';
import { welcomeResultLine } from './hub-welcome.helpers';

function WelcomeOutcome({ data, error }: { data: HubWelcomeResult | undefined; error: Error | null }): JSX.Element | null {
    if (error) {
        return <p role="alert" className="text-sm text-danger" data-testid="guild-settings-welcome-error">{error.message}</p>;
    }
    if (!data) return null;
    return (
        <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-success" data-testid="guild-settings-welcome-result">{welcomeResultLine(data)}</p>
            {data.warning && (
                <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                    data-testid="guild-settings-welcome-warning">{data.warning}</p>
            )}
        </div>
    );
}

/** The button plus its inline outcome; the caller decides who sees it. */
export function HubWelcomeRepost({ guildId }: { guildId: number }): JSX.Element {
    const repost = useRepostHubWelcome(guildId);
    return (
        <>
            <Button variant="secondary" size="sm" onClick={() => repost.mutate()} loading={repost.isPending}
                data-testid="guild-settings-repost-welcome">
                Re-post welcome message
            </Button>
            <div className="basis-full empty:hidden"><WelcomeOutcome data={repost.data} error={repost.error} /></div>
        </>
    );
}

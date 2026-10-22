/**
 * ROK-1893 P1 (ruling §8d, wireframe panel 2) — the hub join prompt the person
 * who signed up sees on the event page, under the signup: `suggest` → "Join
 * <hub>?" with Join hub / Not now; `auto-joined` → a one-time "You joined
 * <hub> — leave anytime" notice that is dismissed when closed.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { HubJoinPrompt } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useAcceptHubJoinPrompt, useDismissHubJoinPrompt, useHubJoinPrompts } from './hub-join-prompts-api';

type Act = (p: HubJoinPrompt) => void;

function SuggestCard({ prompt, onJoin, onDismiss, pending }: { prompt: HubJoinPrompt; onJoin: Act; onDismiss: Act; pending: boolean }): JSX.Element {
    return (
        <section aria-label={`Join ${prompt.hubName}?`} data-testid="hub-join-prompt"
            className="space-y-3 rounded-lg border border-edge bg-surface p-4">
            <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Join {prompt.hubName}?</p>
                <p className="text-xs text-secondary">This event belongs to the hub. Members see its events, polls and posts first.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={pending} onClick={() => onJoin(prompt)}>Join hub</Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => onDismiss(prompt)}>Not now</Button>
            </div>
        </section>
    );
}

function AutoJoinedNotice({ prompt, onDismiss, pending }: { prompt: HubJoinPrompt; onDismiss: Act; pending: boolean }): JSX.Element {
    return (
        <div role="status" data-testid="hub-auto-joined"
            className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
            <p className="min-w-0">
                You joined <Link to={`/guilds/${prompt.hubId}`} className="font-semibold underline">{prompt.hubName}</Link> — leave anytime
            </p>
            <Button variant="ghost" size="sm" disabled={pending} aria-label={`Close the ${prompt.hubName} notice`}
                onClick={() => onDismiss(prompt)}>Close</Button>
        </div>
    );
}

/** The signed-in user's prompts raised by signing up for `eventId`. */
export function HubJoinPrompts({ eventId, enabled }: { eventId: number; enabled: boolean }): JSX.Element | null {
    const prompts = useHubJoinPrompts(enabled);
    const accept = useAcceptHubJoinPrompt();
    const dismiss = useDismissHubJoinPrompt();
    const items = (prompts.data?.items ?? []).filter((p) => p.source === 'signup' && p.sourceRef === eventId);
    if (!enabled || items.length === 0) return null;
    const pending = accept.isPending || dismiss.isPending;
    return (
        <div className="mb-4 flex flex-col gap-3" data-testid="hub-join-prompts">
            {items.map((p) => (p.kind === 'suggest'
                ? <SuggestCard key={p.id} prompt={p} pending={pending} onJoin={(x) => accept.mutate(x)} onDismiss={(x) => dismiss.mutate(x)} />
                : <AutoJoinedNotice key={p.id} prompt={p} pending={pending} onDismiss={(x) => dismiss.mutate(x)} />))}
        </div>
    );
}

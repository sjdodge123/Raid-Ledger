/**
 * ROK-1893 P1 (ruling §8d, wireframe panel 2) — the hub join prompt the person
 * who signed up sees on the event page, under the signup: `suggest` → "Join
 * <hub>?" with Join hub / Not now; `auto-joined` → a one-time "You joined
 * <hub> — leave anytime" notice that is dismissed when closed. A viewer who
 * can't join yet (not in the community Discord server, or no Discord linked)
 * sees the landing page's "Join the Discord server first" / "Link your Discord
 * account first" step in place of Join hub (operator ruling 2026-10-22).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { HubJoinPrompt } from '@raid-ledger/contract';
import { useAuth } from '../../../hooks/use-auth';
import { isDiscordLinked } from '../../../lib/avatar';
import { DiscordFirstBlock, LinkDiscordFirstBlock } from '../../../pages/hub-invite/hub-invite-cards';
import { Button } from '../../ui/button';
import { useAcceptHubJoinPrompt, useDismissHubJoinPrompt, useHubJoinPrompts } from './hub-join-prompts-api';

type Act = (p: HubJoinPrompt) => void;

/** What stands between the viewer and a `suggest` Join (the API requires the Discord server). */
export interface JoinGate {
    /** Viewer is in the community Discord server (the list's `inDiscordServer`). */
    inDiscordServer: boolean;
    /** Bot-made server invite, or null (text-only step). */
    inviteUrl: string | null;
    onRetry: () => void;
    retrying: boolean;
}

const PROMPT_DISCORD_NOTE = "Hub members have to be in the community's Discord server. Join it, then try again here.";
const PROMPT_LINK_NOTE = "Hub members have to be in the community's Discord server, so your account needs Discord linked.";

/** Join hub, or the step the viewer has to take first. */
function JoinAction({ prompt, gate, onJoin, pending }: { prompt: HubJoinPrompt; gate: JoinGate; onJoin: Act; pending: boolean }): JSX.Element {
    const { user } = useAuth();
    if (!isDiscordLinked(user?.discordId)) return <LinkDiscordFirstBlock note={PROMPT_LINK_NOTE} />;
    if (!gate.inDiscordServer) {
        return <DiscordFirstBlock inviteUrl={gate.inviteUrl} onRetry={gate.onRetry} retrying={gate.retrying} note={PROMPT_DISCORD_NOTE} />;
    }
    return <Button size="sm" disabled={pending} onClick={() => onJoin(prompt)}>Join hub</Button>;
}

function SuggestCard({ prompt, gate, onJoin, onDismiss, pending }: {
    prompt: HubJoinPrompt; gate: JoinGate; onJoin: Act; onDismiss: Act; pending: boolean;
}): JSX.Element {
    const blocked = !gate.inDiscordServer;
    return (
        <section aria-label={`Join ${prompt.hubName}?`} data-testid="hub-join-prompt"
            className="space-y-3 rounded-lg border border-edge bg-surface p-4">
            <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Join {prompt.hubName}?</p>
                <p className="text-xs text-secondary">This event belongs to the hub. Members see its events, polls and posts first.</p>
            </div>
            {blocked && <JoinAction prompt={prompt} gate={gate} onJoin={onJoin} pending={pending} />}
            <div className="flex flex-wrap gap-2">
                {!blocked && <JoinAction prompt={prompt} gate={gate} onJoin={onJoin} pending={pending} />}
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

/**
 * The signed-in user's prompts raised by signing up for `eventId`. `hubTagged`
 * (the event has a hub) lets the list poll briefly after a signup here.
 */
export function HubJoinPrompts({ eventId, enabled, hubTagged = false }: {
    eventId: number; enabled: boolean; hubTagged?: boolean;
}): JSX.Element | null {
    const prompts = useHubJoinPrompts(enabled, hubTagged ? eventId : undefined);
    const accept = useAcceptHubJoinPrompt();
    const dismiss = useDismissHubJoinPrompt();
    const items = (prompts.data?.items ?? []).filter((p) => p.source === 'signup' && p.sourceRef === eventId);
    if (!enabled || items.length === 0) return null;
    const pending = accept.isPending || dismiss.isPending;
    const gate: JoinGate = {
        inDiscordServer: prompts.data?.inDiscordServer ?? true,
        inviteUrl: prompts.data?.discordServerInviteUrl ?? null,
        onRetry: () => { void prompts.refetch(); },
        retrying: prompts.isFetching,
    };
    return (
        <div className="mb-4 flex flex-col gap-3" data-testid="hub-join-prompts">
            {items.map((p) => (p.kind === 'suggest'
                ? <SuggestCard key={p.id} prompt={p} gate={gate} pending={pending} onJoin={(x) => accept.mutate(x)} onDismiss={(x) => dismiss.mutate(x)} />
                : <AutoJoinedNotice key={p.id} prompt={p} pending={pending} onDismiss={(x) => dismiss.mutate(x)} />))}
        </div>
    );
}

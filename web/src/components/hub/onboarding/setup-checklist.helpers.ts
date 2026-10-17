/**
 * ROK-1830 S5 (D11-B prompt 2) — what the hub setup checklist shows, derived
 * from page data the Overview already has. No new endpoint and no stored
 * progress: a step is done because the thing it asks for exists, so undoing
 * the edit puts the step back.
 */
import type { GuildDiscordMirrorDto, GuildProfile } from '@raid-ledger/contract';

/** How a step is acted on: a tab hash, or an overlay only the page can open. */
export type SetupStepAction = { kind: 'tab'; hash: string } | { kind: 'channel' } | { kind: 'blocked'; reason: string };

export interface SetupStep {
    id: string;
    label: string;
    done: boolean;
    action: SetupStepAction;
}

export interface SetupStepsInput {
    profile: GuildProfile | undefined;
    discord: GuildDiscordMirrorDto | undefined;
    /** A mod source reports content for this hub (core asks the module, S5b). */
    modsConfigured: boolean;
}

/**
 * ROK-1831 owns `guilds.hidden_at`, so publishing cannot be done from here
 * yet; the step is listed with its reason rather than hidden, which is what
 * the approved prototype shows.
 */
export const PUBLISH_BLOCKED_REASON = 'Hubs are visible to members already — a hidden-by-default hub is coming.';

export function setupSteps({ profile, discord, modsConfigured }: SetupStepsInput): SetupStep[] {
    return [
        { id: 'leader-post', label: 'Write a leader post', done: (profile?.gmPost?.body ?? '').trim().length > 0, action: { kind: 'tab', hash: '#overview' } },
        { id: 'rules', label: 'Add your guild rules', done: (profile?.rules.length ?? 0) > 0, action: { kind: 'tab', hash: '#resources' } },
        { id: 'links', label: 'Add useful links', done: (profile?.links.length ?? 0) > 0, action: { kind: 'tab', hash: '#resources' } },
        { id: 'discord', label: 'Pick a Discord channel', done: discord !== undefined && discord.state !== 'unset', action: { kind: 'channel' } },
        { id: 'mods', label: 'Recommend mods', done: modsConfigured, action: { kind: 'tab', hash: '#resources' } },
        { id: 'publish', label: 'Publish this hub', done: false, action: { kind: 'blocked', reason: PUBLISH_BLOCKED_REASON } },
    ];
}

export interface SetupProgress {
    done: number;
    /** Blocked steps are excluded — one of them can never be ticked, so counting it would pin the checklist below 100% forever. */
    total: number;
    complete: boolean;
    label: string;
}

export function setupProgress(steps: readonly SetupStep[]): SetupProgress {
    const countable = steps.filter((s) => s.action.kind !== 'blocked');
    const done = countable.filter((s) => s.done).length;
    return { done, total: countable.length, complete: done === countable.length, label: `${done} of ${countable.length}` };
}

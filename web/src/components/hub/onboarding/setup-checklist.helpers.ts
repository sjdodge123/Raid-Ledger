/**
 * ROK-1830 S5 (D11-B prompt 2) — what the hub setup checklist shows, derived
 * from page data the Overview already has. No new endpoint and no stored
 * progress: a step is done because the thing it asks for exists, so undoing
 * the edit puts the step back.
 *
 * The step set is the spec's D11-B list (Leader, roster, leader post, Discord
 * channel, next raid) merged with the prototype's content steps (rules, links,
 * recommended mods); the spec's wording wins (Lead ruling, PR-3 r1).
 */
import type { GuildDiscordMirrorDto, GuildKind, GuildProfile } from '@raid-ledger/contract';

/** How a step is acted on: a tab hash, or an overlay only the page can open. */
export type SetupStepAction = { kind: 'tab'; hash: string } | { kind: 'channel' } | { kind: 'invite' } | { kind: 'blocked'; reason: string };

export interface SetupStep {
    id: string;
    label: string;
    /** One line under the label saying what the step buys (S0 prototype). */
    description: string;
    done: boolean;
    action: SetupStepAction;
    /** The verb on the row's button — the prototype labels the work, not "Open". */
    actionLabel: string;
}

export interface SetupStepsInput {
    profile: GuildProfile | undefined;
    discord: GuildDiscordMirrorDto | undefined;
    /** Spec D11-B "roster imported" — the hub's member count. */
    memberCount: number;
    /** Spec D11-B "tag your next raid" — a raid sits on the schedule. */
    hasNextRaid: boolean;
    /** A mod source reports content for this hub (core asks the module, S5b). */
    modsConfigured: boolean;
    /** The hub kind registers at least one mod source. Lead ruling 3: no sources, no step. */
    hasModSources: boolean;
    /** This viewer can open the channel picker — Leader and admin only. */
    canPickChannel: boolean;
    /** ROK-1831/1891: the hub kind; non-WoW kinds drop the WoW-only steps and swap copy. Default: WoW. */
    kind?: GuildKind | undefined;
}

type StepCopy = Partial<Pick<SetupStep, 'label' | 'description' | 'actionLabel' | 'action'>>;

/**
 * ROK-1831/1870/1891: steps a kind never has. A server hub has no roster
 * import and no Publish (the admin switch is the publish); a community hub's
 * leader is its approved proposer and it has no hide switch (Archive replaces it).
 */
const DROPPED: Readonly<Record<GuildKind, ReadonlySet<string>>> = {
    wow_guild: new Set(),
    game_server: new Set(['roster', 'publish']),
    game_community: new Set(['leader', 'publish']),
};

/** ROK-1831/1891: per-kind copy for the core steps whose WoW wording does not fit. */
const KIND_COPY: Readonly<Record<GuildKind, Readonly<Record<string, StepCopy>>>> = {
    wow_guild: {},
    game_server: {
        leader: { action: { kind: 'blocked', reason: 'An admin is the hub Leader for now — naming one from the members is coming.' } },
        rules: { label: 'Add your server rules', description: 'They show on the Resources tab.', actionLabel: 'Add rules' },
        links: { label: 'Add your server info', description: 'Connect address, mod packs and other links, all on Resources.', actionLabel: 'Add info' },
        discord: { label: 'Link your Discord channel' },
        'next-raid': { label: 'Schedule your first event', description: 'Events show on the Events tab.', actionLabel: 'Schedule' },
    },
    game_community: {
        rules: { label: 'Add your hub rules' },
        links: { description: 'Discord, guides and connect info, all on Resources.' },
        'next-raid': { label: 'Schedule your first event', description: 'Events show on the Events tab.', actionLabel: 'Schedule' },
    },
};

/**
 * ROK-1891: a community hub grows by invitation, not a roster import. The proposer is member one.
 * Approved copy (pending-approval/_approved/ROK-1891-hub-copy); the action opens #1742's
 * invite-link dialog, which the page shows only to a viewer who may make invite links.
 */
function inviteStep(memberCount: number): SetupStep {
    return {
        id: 'invite', label: 'Invite players to the hub', description: 'Share the hub link so players can find it and join.',
        done: memberCount > 1, action: { kind: 'invite' }, actionLabel: 'Invite',
    };
}

/** Apply the per-kind step set and copy. */
function forKind(steps: SetupStep[], kind: GuildKind, memberCount: number): SetupStep[] {
    const dropped = DROPPED[kind];
    const copy = KIND_COPY[kind];
    return steps
        .filter((s) => !dropped.has(s.id))
        .map((s) => (kind === 'game_community' && s.id === 'roster' ? inviteStep(memberCount) : { ...s, ...(copy[s.id] ?? {}) }));
}

/**
 * Spec Q1: Leader is the GM or an admin today and there is nowhere to store
 * an admin-named one, so D11-B's first step is listed with its reason instead
 * of being actionable.
 */
export const LEADER_BLOCKED_REASON = 'An admin is the hub Leader for now — naming one from the roster is coming.';

/**
 * Lead ruling 1: an Officer has no channel picker, so the step renders as a
 * non-actionable "ask your Leader" row. Blocked steps leave `countable`, so it
 * no longer pins the card below 100% — the checklist can still self-remove.
 */
export const CHANNEL_BLOCKED_REASON = 'Ask your Leader or an admin to set the hub channel.';

/**
 * ROK-1891: a hub is visible to its members from the start, and the one
 * visibility control is the admin-only "Hide this hub" switch (ROK-1831) in
 * Guild settings → Visibility, so the step points there instead of promising
 * a hidden-by-default hub. Only a WoW guild keeps the step (see DROPPED).
 */
export const PUBLISH_BLOCKED_REASON = 'Members can already see this hub. An admin can hide it in Guild settings → Visibility.';

/** The steps every hub starts with, in the prototype's order. */
function baseSteps(input: SetupStepsInput, channel: SetupStepAction): SetupStep[] {
    const { profile, discord, memberCount } = input;
    return [
        {
            id: 'leader', label: 'Assign a Leader', description: 'An admin names who runs this hub.',
            done: false, action: { kind: 'blocked', reason: LEADER_BLOCKED_REASON }, actionLabel: 'Assign',
        },
        {
            id: 'roster', label: 'Import your roster', description: 'Your guildmates appear on the Members tab.',
            done: memberCount > 0, action: { kind: 'tab', hash: '#members' }, actionLabel: 'Import',
        },
        {
            id: 'leader-post', label: 'Write a leader post', description: 'It sits at the top of Overview.',
            done: (profile?.latestPost?.body ?? profile?.gmPost?.body ?? '').trim().length > 0, action: { kind: 'tab', hash: '#overview' }, actionLabel: 'Write post',
        },
        {
            id: 'rules', label: 'Add your guild rules', description: 'They show on the Resources tab.',
            done: (profile?.rules.length ?? 0) > 0, action: { kind: 'tab', hash: '#resources' }, actionLabel: 'Add rules',
        },
        {
            id: 'links', label: 'Add useful links', description: 'Discord, logs and loot sheets, all on Resources.',
            done: (profile?.links.length ?? 0) > 0, action: { kind: 'tab', hash: '#resources' }, actionLabel: 'Add links',
        },
        {
            id: 'discord', label: 'Pick a Discord channel', description: 'Members see its latest posts.',
            done: discord !== undefined && discord.state !== 'unset', action: channel, actionLabel: 'Pick channel',
        },
    ];
}

export function setupSteps(input: SetupStepsInput): SetupStep[] {
    const { hasNextRaid, modsConfigured, hasModSources, canPickChannel } = input;
    const channel: SetupStepAction = canPickChannel ? { kind: 'channel' } : { kind: 'blocked', reason: CHANNEL_BLOCKED_REASON };
    const steps = baseSteps(input, channel);
    if (hasModSources) {
        steps.push({
            id: 'mods', label: 'Recommend mods', description: 'Point members at the addons you expect.',
            done: modsConfigured, action: { kind: 'tab', hash: '#resources' }, actionLabel: 'Pick mods',
        });
    }
    steps.push({
        id: 'next-raid', label: 'Tag your next raid', description: 'Tagged events show on the Events tab.',
        done: hasNextRaid, action: { kind: 'tab', hash: '#events' }, actionLabel: 'Tag a raid',
    });
    steps.push({
        id: 'publish', label: 'Publish this hub', description: 'Decide who can find the hub.',
        done: false, action: { kind: 'blocked', reason: PUBLISH_BLOCKED_REASON }, actionLabel: 'Publish',
    });
    return forKind(steps, input.kind ?? 'wow_guild', input.memberCount);
}

export interface SetupProgress {
    done: number;
    /** 0–100, for the progress bar the S0 prototype puts above the rows. */
    pct: number;
    /** Blocked steps are excluded — one of them can never be ticked, so counting it would pin the checklist below 100% forever. */
    total: number;
    complete: boolean;
    label: string;
}

export function setupProgress(steps: readonly SetupStep[]): SetupProgress {
    const countable = steps.filter((s) => s.action.kind !== 'blocked');
    const done = countable.filter((s) => s.done).length;
    const total = countable.length;
    return {
        done, total, pct: total === 0 ? 100 : Math.round((done / total) * 100),
        complete: done === total, label: `${done} of ${total}`,
    };
}

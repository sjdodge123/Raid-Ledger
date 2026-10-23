/**
 * ROK-1830 S5b — step derivation for the hub setup checklist.
 */
import { describe, expect, it } from 'vitest';
import type { GuildDiscordMirrorDto, GuildProfile } from '@raid-ledger/contract';
import { at } from '../../../test/defined';
import { CHANNEL_BLOCKED_REASON, LEADER_BLOCKED_REASON, PUBLISH_BLOCKED_REASON, setupProgress, setupSteps, type SetupStepsInput } from './setup-checklist.helpers';

const EMPTY: GuildProfile = { guildId: 7, gmPost: null, rules: [], links: [] };
const FULL: GuildProfile = {
    guildId: 7,
    gmPost: { body: 'Raid night is Tuesday.', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'Jake' },
    rules: [{ title: 'Be on time', body: 'Invites go out at 19:45.' }],
    links: [{ title: 'Links', links: [{ label: 'Discord', url: 'https://discord.gg/x' }] }],
};
const UNSET: GuildDiscordMirrorDto = { state: 'unset' };
const BOUND: GuildDiscordMirrorDto = { state: 'disconnected', channelId: '123' };

/** A hub the viewer can fully act on: Leader/admin, roster imported, mods available. */
const BASE = { memberCount: 40, hasNextRaid: false, hasModSources: true, canPickChannel: true };
const input = (over: Partial<SetupStepsInput>): SetupStepsInput => ({ ...BASE, profile: EMPTY, discord: UNSET, modsConfigured: false, ...over });

function doneIds(over: Partial<SetupStepsInput>): string[] {
    return setupSteps(input(over)).filter((s) => s.done).map((s) => s.id);
}

function ids(over: Partial<SetupStepsInput>): string[] {
    return setupSteps(input(over)).map((s) => s.id);
}

describe('setupSteps', () => {
    it('a brand-new hub has nothing done', () => {
        expect(doneIds({ memberCount: 0 })).toEqual([]);
    });

    it('each piece of content ticks exactly its own step', () => {
        expect(doneIds({ profile: FULL, discord: BOUND, modsConfigured: true, hasNextRaid: true }))
            .toEqual(['roster', 'leader-post', 'rules', 'links', 'discord', 'mods', 'next-raid']);
    });

    it('a whitespace-only leader post does not count as written', () => {
        const blank: GuildProfile = { ...EMPTY, gmPost: { body: '   \n ', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: null } };
        expect(doneIds({ profile: blank, memberCount: 0 })).toEqual([]);
    });

    it('unknown page data leaves every step undone rather than guessing', () => {
        expect(doneIds({ profile: undefined, discord: undefined, memberCount: 0 })).toEqual([]);
    });

    it('publish is listed but blocked, with the reason the viewer sees', () => {
        const publish = at(setupSteps(input({ profile: FULL, discord: BOUND, modsConfigured: true })).filter((s) => s.id === 'publish'), 0);
        expect(publish.done).toBe(false);
        expect(publish.action).toEqual({ kind: 'blocked', reason: PUBLISH_BLOCKED_REASON });
    });

    // Spec D11-B asks for "Assign a Leader" first; Q1 leaves nowhere to store
    // an admin-named one, so it is a listed, non-actionable row.
    it('lists the spec step set in order, Assign a Leader first and blocked', () => {
        expect(ids({})).toEqual(['leader', 'roster', 'leader-post', 'rules', 'links', 'discord', 'mods', 'next-raid', 'publish']);
        const leader = at(setupSteps(input({})).filter((s) => s.id === 'leader'), 0);
        expect(leader.action).toEqual({ kind: 'blocked', reason: LEADER_BLOCKED_REASON });
    });

    // Lead ruling 1: an Officer has no picker, so the step says who to ask.
    it('a viewer who cannot pick a channel gets an ask-your-Leader row', () => {
        const step = at(setupSteps(input({ canPickChannel: false })).filter((s) => s.id === 'discord'), 0);
        expect(step.action).toEqual({ kind: 'blocked', reason: CHANNEL_BLOCKED_REASON });
    });

    // Lead ruling 3: a hub kind with no mod sources never shows the step.
    it('hides the mods step on a hub with no mod sources', () => {
        expect(ids({ hasModSources: false })).not.toContain('mods');
    });
});

describe('setupProgress', () => {
    it('counts only actionable steps, so a finished hub reads 7 of 7 and complete', () => {
        const progress = setupProgress(setupSteps(input({ profile: FULL, discord: BOUND, modsConfigured: true, hasNextRaid: true })));
        expect(progress).toEqual({ done: 7, total: 7, pct: 100, complete: true, label: '7 of 7' });
    });

    it('a half-set-up hub is not complete', () => {
        const progress = setupProgress(setupSteps(input({ profile: FULL })));
        expect(progress.label).toBe('4 of 7');
        expect(progress.pct).toBe(57);
        expect(progress.complete).toBe(false);
    });

    // Lead ruling 1: the blocked channel row must not pin the card open — an
    // Officer who has done everything else still sees it finish.
    it('an Officer reaches 6 of 6 — the blocked channel row is not counted', () => {
        // Countable for an Officer: roster, leader-post, rules, links, mods,
        // next-raid. `leader` and `publish` are blocked for everyone; `discord`
        // is blocked only here, so the total drops from 7 to 6, not the done.
        const progress = setupProgress(setupSteps(input({
            profile: FULL, discord: UNSET, modsConfigured: true, hasNextRaid: true, canPickChannel: false,
        })));
        expect(progress).toEqual({ done: 6, total: 6, pct: 100, complete: true, label: '6 of 6' });
    });
});

describe('setupSteps — game_server hubs (ROK-1831)', () => {
    it('drops the WoW-only roster and publish steps and keeps the core ones', () => {
        expect(ids({ kind: 'game_server', hasModSources: false })).toEqual(['leader', 'leader-post', 'rules', 'links', 'discord', 'next-raid']);
    });

    it('uses server copy for rules, links and the first event', () => {
        const steps = setupSteps(input({ kind: 'game_server', hasModSources: false }));
        const byId = (id: string): string => steps.find((s) => s.id === id)?.label ?? '';
        expect(byId('rules')).toBe('Add your server rules');
        expect(byId('next-raid')).toBe('Schedule your first event');
    });

    it('a WoW hub keeps the full list', () => {
        expect(ids({ kind: 'wow_guild' })).toContain('publish');
        expect(ids({ kind: 'wow_guild' })).toContain('roster');
    });
});

describe('setupSteps — game_community hubs (ROK-1870)', () => {
    it('drops "Assign a Leader": the approved proposer already leads', () => {
        expect(ids({ kind: 'game_community' })).not.toContain('leader');
        expect(ids({})).toContain('leader');
    });

    it('swaps the roster import for an invite step and drops Publish (ROK-1891)', () => {
        expect(ids({ kind: 'game_community', hasModSources: false })).toEqual(['invite', 'leader-post', 'rules', 'links', 'discord', 'next-raid']);
        const invite = setupSteps(input({ kind: 'game_community', memberCount: 1 })).find((s) => s.id === 'invite');
        expect(invite?.label).toBe('Invite players to the hub');
        expect(invite?.done).toBe(false);
        expect(setupSteps(input({ kind: 'game_community', memberCount: 2 })).find((s) => s.id === 'invite')?.done).toBe(true);
    });
});

describe('setupSteps — no WoW wording off WoW hubs (ROK-1891)', () => {
    const wording = (kind: 'game_server' | 'game_community'): string => setupSteps(input({ kind, hasModSources: false }))
        .map((s) => [s.label, s.description, s.actionLabel, s.action.kind === 'blocked' ? s.action.reason : ''].join(' '))
        .join(' | ');

    it.each(['game_server', 'game_community'] as const)('%s steps never say guild, raid, roster or guildmates', (kind) => {
        expect(wording(kind)).not.toMatch(/guild|raid|roster/i);
    });

    it('a server hub links its Discord channel and adds server info', () => {
        const steps = setupSteps(input({ kind: 'game_server', hasModSources: false }));
        expect(steps.find((s) => s.id === 'discord')?.label).toBe('Link your Discord channel');
        expect(steps.find((s) => s.id === 'links')?.label).toBe('Add your server info');
    });

    it('a WoW guild keeps its guild wording', () => {
        const steps = setupSteps(input({ kind: 'wow_guild' }));
        expect(steps.find((s) => s.id === 'roster')?.label).toBe('Import your roster');
        expect(steps.find((s) => s.id === 'rules')?.label).toBe('Add your guild rules');
        expect(steps.find((s) => s.id === 'next-raid')?.label).toBe('Tag your next raid');
    });
});

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
        expect(progress).toEqual({ done: 7, total: 7, complete: true, label: '7 of 7' });
    });

    it('a half-set-up hub is not complete', () => {
        const progress = setupProgress(setupSteps(input({ profile: FULL })));
        expect(progress.label).toBe('4 of 7');
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
        expect(progress).toEqual({ done: 6, total: 6, complete: true, label: '6 of 6' });
    });
});

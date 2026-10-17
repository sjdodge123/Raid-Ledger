/**
 * ROK-1830 S5b — step derivation for the hub setup checklist.
 */
import { describe, expect, it } from 'vitest';
import type { GuildDiscordMirrorDto, GuildProfile } from '@raid-ledger/contract';
import { at } from '../../../test/defined';
import { PUBLISH_BLOCKED_REASON, setupProgress, setupSteps } from './setup-checklist.helpers';

const EMPTY: GuildProfile = { guildId: 7, gmPost: null, rules: [], links: [] };
const FULL: GuildProfile = {
    guildId: 7,
    gmPost: { body: 'Raid night is Tuesday.', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'Jake' },
    rules: [{ title: 'Be on time', body: 'Invites go out at 19:45.' }],
    links: [{ title: 'Links', links: [{ label: 'Discord', url: 'https://discord.gg/x' }] }],
};
const UNSET: GuildDiscordMirrorDto = { state: 'unset' };
const BOUND: GuildDiscordMirrorDto = { state: 'disconnected', channelId: '123' };

function doneIds(input: Parameters<typeof setupSteps>[0]): string[] {
    return setupSteps(input).filter((s) => s.done).map((s) => s.id);
}

describe('setupSteps', () => {
    it('a brand-new hub has nothing done', () => {
        expect(doneIds({ profile: EMPTY, discord: UNSET, modsConfigured: false })).toEqual([]);
    });

    it('each piece of content ticks exactly its own step', () => {
        expect(doneIds({ profile: FULL, discord: BOUND, modsConfigured: true }))
            .toEqual(['leader-post', 'rules', 'links', 'discord', 'mods']);
    });

    it('a whitespace-only leader post does not count as written', () => {
        const blank: GuildProfile = { ...EMPTY, gmPost: { body: '   \n ', updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: null } };
        expect(doneIds({ profile: blank, discord: UNSET, modsConfigured: false })).toEqual([]);
    });

    it('unknown page data leaves every step undone rather than guessing', () => {
        expect(doneIds({ profile: undefined, discord: undefined, modsConfigured: false })).toEqual([]);
    });

    it('publish is listed but blocked, with the reason the viewer sees', () => {
        const publish = at(setupSteps({ profile: FULL, discord: BOUND, modsConfigured: true }).filter((s) => s.id === 'publish'), 0);
        expect(publish.done).toBe(false);
        expect(publish.action).toEqual({ kind: 'blocked', reason: PUBLISH_BLOCKED_REASON });
    });
});

describe('setupProgress', () => {
    it('counts only actionable steps, so a finished hub reads 5 of 5 and complete', () => {
        const progress = setupProgress(setupSteps({ profile: FULL, discord: BOUND, modsConfigured: true }));
        expect(progress).toEqual({ done: 5, total: 5, complete: true, label: '5 of 5' });
    });

    it('a half-set-up hub is not complete', () => {
        const progress = setupProgress(setupSteps({ profile: FULL, discord: UNSET, modsConfigured: false }));
        expect(progress.label).toBe('3 of 5');
        expect(progress.complete).toBe(false);
    });
});

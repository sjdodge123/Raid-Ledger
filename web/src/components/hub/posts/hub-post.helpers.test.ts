/** ROK-1868 V1 — pure hub-post helpers. */
import { describe, expect, it } from 'vitest';
import { HUB_POST_MARKDOWN_MESSAGES } from '@raid-ledger/contract';
import { buildHubPost } from '../../../test/factories/hub-posts';
import {
    bodyError, BODY_TOO_LONG, isEdited, postIdFromSearch, postMeta, relayHint, relayOutcomeNotice, serverBodyError,
} from './hub-post.helpers';

describe('relayHint', () => {
    it('names the channel when it is usable', () => {
        expect(relayHint({ state: 'ok', channelId: '1', channelName: 'news' }, 'wow_guild', true))
            .toEqual({ text: 'Posts to #news. Edits stay on Raid Ledger.', tone: 'muted' });
    });
    it('tells a leader to link a channel and an officer who can', () => {
        expect(relayHint({ state: 'unset' }, 'wow_guild', true).text).toBe('Link a Discord channel in Guild settings to post there.');
        expect(relayHint({ state: 'unset' }, 'wow_guild', false).text).toBe('Your guild master can link a Discord channel in Guild settings.');
        expect(relayHint({ state: 'unset' }, 'game_server', false).text).toBe('Your server leader can link a Discord channel in Server settings.');
        expect(relayHint({ state: 'unset' }, 'game_server', true).tone).toBe('warning');
    });
    it('explains a refusing, missing or offline channel', () => {
        expect(relayHint({ state: 'no-permission', channelId: '1', channelName: 'news' }, 'wow_guild', true).text)
            .toBe("The bot can't post in #news. Give it Send Messages and Embed Links.");
        expect(relayHint({ state: 'no-permission', channelId: '1', channelName: null }, 'wow_guild', true).text)
            .toBe("The bot can't post in the linked channel. Give it Send Messages and Embed Links.");
        expect(relayHint({ state: 'gone', channelId: '1' }, 'wow_guild', true).text).toBe('The linked channel no longer exists.');
        expect(relayHint({ state: 'disconnected' }, 'wow_guild', true).text).toBe('Discord is offline right now.');
    });
});

describe('isEdited / postMeta', () => {
    it('a fresh post is not edited and reads "Posted <date>"', () => {
        const post = buildHubPost({ createdAt: '2026-10-03T12:00:00.000Z' });
        expect(isEdited(post)).toBe(false);
        expect(postMeta(post)).toMatch(/^Posted .*2026$/);
    });
    it('an edited post appends who edited it', () => {
        const post = buildHubPost({ editedBy: { userId: 2, displayName: 'Kara', avatarUrl: null } });
        expect(isEdited(post)).toBe(true);
        expect(postMeta(post)).toMatch(/ · Edited .* by Kara$/);
        expect(postMeta(buildHubPost({ editedBy: { userId: null, displayName: null, avatarUrl: null } }))).toMatch(/by a former member$/);
    });
});

describe('postIdFromSearch', () => {
    it('reads a positive integer ?post= and rejects anything else', () => {
        expect(postIdFromSearch('?post=3')).toBe(3);
        expect(postIdFromSearch('?x=1&post=12')).toBe(12);
        expect(postIdFromSearch('?post=abc')).toBeNull();
        expect(postIdFromSearch('?post=0')).toBeNull();
        expect(postIdFromSearch('')).toBeNull();
    });
});

describe('bodyError', () => {
    it('reports HTML, an over-long source, or nothing', () => {
        expect(bodyError('<b>hi</b>')).toBe(HUB_POST_MARKDOWN_MESSAGES.html);
        expect(bodyError('[x](javascript:alert(1))')).toBe(HUB_POST_MARKDOWN_MESSAGES['unsafe-link']);
        expect(bodyError('a'.repeat(4001))).toBe(BODY_TOO_LONG);
        expect(BODY_TOO_LONG).toBe('Too long — formatting counts toward the 4000 characters.');
        expect(bodyError('**Raid** tonight')).toBeNull();
        expect(bodyError('')).toBeNull();
    });
});

describe('relayOutcomeNotice', () => {
    it('confirms a send, warns on a failure, says nothing when not asked', () => {
        expect(relayOutcomeNotice('sent', 'news')).toEqual({ tone: 'success', text: 'Posted. It’s in #news on Discord too.' });
        expect(relayOutcomeNotice('failed', 'news')?.tone).toBe('warning');
        expect(relayOutcomeNotice('unavailable', null)?.tone).toBe('warning');
        expect(relayOutcomeNotice('not_requested', 'news')).toBeNull();
    });
});

describe('serverBodyError', () => {
    it('reads the first body message from a 400 payload', () => {
        const err = Object.assign(new Error('Bad'), {});
        Object.defineProperty(err, 'body', { value: { fieldErrors: { body: ['No HTML'] } } });
        expect(serverBodyError(err)).toBe('No HTML');
        expect(serverBodyError(new Error('boom'))).toBeNull();
        expect(serverBodyError(null)).toBeNull();
    });
});

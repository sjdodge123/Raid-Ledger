import { describe, it, expect } from 'vitest';
import { withErrorBody, withHttpStatus } from '../../lib/api/api-error';
import { bindingErrorMessage } from './binding-error.helpers';
import type { BindingChannelOption } from './BindingCreateForm';

const CHANNELS: BindingChannelOption[] = [{ id: 'c-qp', name: 'qp-valheim', channelType: 'text' }];
const API_MESSAGE = 'That game already announces Quick Play in another channel. Remove or edit that binding first.';

function conflict(body: Record<string, unknown>): Error {
    return withErrorBody(withHttpStatus(new Error(API_MESSAGE), 409), { message: API_MESSAGE, ...body });
}

describe('bindingErrorMessage (ROK-1766)', () => {
    it('names the channel that already posts Quick Play for the game', () => {
        expect(bindingErrorMessage(conflict({ code: 'BINDING_QP_GAME_TAKEN', channelId: 'c-qp' }), CHANNELS))
            .toBe('This game already posts Quick Play to #qp-valheim. Remove or edit that binding first.');
    });

    it('falls back to the API message when the channel is not in the list', () => {
        expect(bindingErrorMessage(conflict({ code: 'BINDING_QP_GAME_TAKEN', channelId: 'gone' }), CHANNELS))
            .toBe(API_MESSAGE);
    });

    it('passes any other error through unchanged, and no error as null', () => {
        expect(bindingErrorMessage(conflict({ code: 'SOMETHING_ELSE', channelId: 'c-qp' }), CHANNELS)).toBe(API_MESSAGE);
        expect(bindingErrorMessage(new Error('boom'), CHANNELS)).toBe('boom');
        expect(bindingErrorMessage(null, CHANNELS)).toBeNull();
    });
});

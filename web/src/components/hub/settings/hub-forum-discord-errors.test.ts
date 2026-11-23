/**
 * ROK-2272 S0b — the reserved own-forum name error names the channel the
 * admin actually typed: the default `#event-planning` or the legacy
 * `#hub-forums` (both are refused by the api).
 */
import { describe, it, expect } from 'vitest';
import { withErrorBody } from '../../../lib/api/api-error';
import { nameFieldError } from './hub-forum-discord-errors';

const reserved = withErrorBody(new Error('reserved'), { code: 'FORUM_DISCORD_NAME_RESERVED', message: 'x' });

describe('nameFieldError', () => {
    it('is undefined for any other error', () => {
        expect(nameFieldError(withErrorBody(new Error('x'), { code: 'FORUM_DISCORD_TAG_LIMIT' }), 'raiders')).toBeUndefined();
    });
    it('names #event-planning when the admin typed the default name', () => {
        expect(nameFieldError(reserved, 'Event Planning')).toBe('#event-planning is the shared forum. Pick another name for this hub’s own forum.');
    });
    it('names #hub-forums when the admin typed the legacy name', () => {
        expect(nameFieldError(reserved, 'Hub Forums')).toBe(
            '#hub-forums is reserved for the shared forum (#event-planning). Pick another name for this hub’s own forum.',
        );
    });
});

import { describe, it, expect } from 'vitest';
import { backfillStatus, backfillSummary, mediaChannelState } from '../../../test/mocks/hub-media-channel-handlers';
import { backfillStatusLine, initialMediaChoice } from './hub-media-channel.helpers';

describe('initialMediaChoice', () => {
    it('prefers the bound channel, then the mirror suggestion, then none', () => {
        expect(initialMediaChoice(mediaChannelState({ channelId: '1', suggestedChannelId: '2' }))).toBe('1');
        expect(initialMediaChoice(mediaChannelState({ suggestedChannelId: '2' }))).toBe('2');
        expect(initialMediaChoice(mediaChannelState())).toBe('');
    });
});

describe('backfillStatusLine', () => {
    it('is null before any run', () => {
        expect(backfillStatusLine(backfillStatus('idle'))).toBeNull();
    });
    it('names a failed run with its counts', () => {
        expect(backfillStatusLine(backfillStatus('failed', backfillSummary({ failed: 4 })))).toMatch(/^The scan stopped early\. .*4 failed$/);
    });
    it('reads "Scanning…" for a run with no counts yet', () => {
        expect(backfillStatusLine(backfillStatus('running'))).toBe('Scanning…');
    });
});

import { describe, it, expect } from 'vitest';
import { describeCron } from './cron-utils';

/** TDB 3857 — an hourly cron at a fixed minute reads as prose, not the raw expression. */
describe('describeCron — hourly at a fixed minute', () => {
    it('describes `0 30 * * * *` as every hour at :30', () => {
        expect(describeCron('0 30 * * * *')).toBe('Every hour at :30');
    });

    it('zero-pads a single-digit minute', () => {
        expect(describeCron('0 5 * * * *')).toBe('Every hour at :05');
    });

    it('keeps the raw expression when the seconds field is not 0', () => {
        expect(describeCron('15 30 * * * *')).toBe('15 30 * * * *');
    });

    it('keeps the minute-interval wording', () => {
        expect(describeCron('0 */5 * * * *')).toBe('Every 5 minutes');
        expect(describeCron('0 */1 * * * *')).toBe('Every minute');
    });

    it('keeps the daily wording', () => {
        expect(describeCron('0 0 5 * * *')).toBe('Daily at 5:00 AM');
        expect(describeCron('0 0 0 * * *')).toBe('Daily at 12:00 AM');
    });
});

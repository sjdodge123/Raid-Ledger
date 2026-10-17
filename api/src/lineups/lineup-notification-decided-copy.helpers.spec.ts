/**
 * ROK-1302 — decided-embed copy adapts to the scheduling opt-out.
 */
import { decidedEmbedCopy } from './lineup-notification-decided-copy.helpers';

describe('decidedEmbedCopy (ROK-1302)', () => {
  it('uses "ready to schedule" copy when scheduling is enabled', () => {
    const copy = decidedEmbedCopy(true);
    expect(copy.body).toContain('ready to schedule');
    expect(copy.schedulingFieldName).toContain('Ready to Schedule');
    expect(copy.rallyFieldName).toContain('Rally More Players');
  });

  it('uses terminal copy + no scheduling language when disabled', () => {
    const copy = decidedEmbedCopy(false);
    expect(copy.body).not.toMatch(/ready to schedule|pick a time/i);
    expect(copy.body).toContain('no scheduling poll');
    expect(copy.schedulingFieldName).toContain('Your Games');
    expect(copy.rallyFieldName).not.toMatch(/rally/i);
  });
});

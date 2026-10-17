/**
 * ROK-1480 — nothing Admin → Scheduled Jobs renders names an internal ticket.
 *
 * Every description in `CORE_JOB_METADATA` is rendered verbatim into the admin
 * cron panel, so a ticket id written there is copy a human reads. Seven of
 * them carried one, including the `ROK-1240` suffix quoted in the story.
 *
 * This asserts on the metadata VALUES rather than scanning the source, so a
 * ticket id in a comment or JSDoc in the same file — deliberate provenance
 * this repo uses everywhere — cannot trip it. The prose you are reading names
 * the very pattern the test forbids and is invisible to it for that reason.
 */
import { CORE_JOB_METADATA } from './cron-job.constants';

const TICKET_REF = /ROK-\d{2,4}/;

describe('CORE_JOB_METADATA user-facing copy (ROK-1480)', () => {
  const entries = Object.entries(CORE_JOB_METADATA);

  it('guards a non-empty set of jobs (the guard itself is alive)', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it('no rendered description names an internal ticket', () => {
    const offenders = entries
      .filter(([, meta]) => TICKET_REF.test(meta.description))
      .map(([key, meta]) => `${key}: ${meta.description}`);

    expect(offenders).toEqual([]);
  });
});

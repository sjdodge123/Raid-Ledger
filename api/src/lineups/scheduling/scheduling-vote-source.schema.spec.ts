/**
 * ROK-1550 — the vote body's `source` field, asserted where it RUNS.
 *
 * The schema itself lives in `packages/contract/src/lineup-scheduling.schema.ts`,
 * but that workspace declares no test runner (api Jest has `rootDir: 'src'`,
 * web Vitest is scoped to `web/`), so its `src/__tests__/*.spec.ts` files are
 * executed by nothing — see TECH-DEBT-BACKLOG.md and the same note on
 * `api/src/backup/restore-drill-report.schema.spec.ts`. The assertions live
 * here so a widened enum or a dropped default fails a job someone watches.
 *
 * What is load-bearing: the DEFAULT. Lane 2's web client and every Discord
 * link are new, but a browser holding a cached pre-ROK-1550 bundle posts a
 * body with no `source` at all — and that vote must be recorded as `web`, not
 * rejected and not stored as null.
 */
import {
  ScheduleVoteSourceSchema,
  ToggleScheduleVoteSchema,
  type ScheduleVoteSource,
} from '@raid-ledger/contract';

describe('ScheduleVoteSourceSchema (ROK-1550)', () => {
  it('admits exactly web and discord', () => {
    expect(ScheduleVoteSourceSchema.parse('web')).toBe('web');
    expect(ScheduleVoteSourceSchema.parse('discord')).toBe('discord');
    expect(ScheduleVoteSourceSchema.options).toEqual(['web', 'discord']);
  });

  it.each(['', 'WEB', 'Discord', 'slack', 'web ', null, 3])(
    'rejects %p',
    (value) => {
      expect(ScheduleVoteSourceSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('ToggleScheduleVoteSchema carries the source (ROK-1550)', () => {
  it('defaults an omitted source to web', () => {
    // Exactly the body a pre-ROK-1550 client posts.
    const parsed = ToggleScheduleVoteSchema.parse({ slotId: 7 });
    expect(parsed.source).toBe('web');
    // The ROK-1617 default is untouched by this story.
    expect(parsed.stance).toBe('yes');
  });

  it('keeps an explicit discord source alongside a no stance', () => {
    const parsed = ToggleScheduleVoteSchema.parse({
      slotId: 7,
      stance: 'no',
      source: 'discord',
    });
    expect(parsed).toEqual({ slotId: 7, stance: 'no', source: 'discord' });
  });

  it('rejects an unknown source rather than falling back to web', () => {
    const result = ToggleScheduleVoteSchema.safeParse({
      slotId: 7,
      source: 'bogus',
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected a validation failure');
    expect(result.error.flatten().fieldErrors.source).toBeDefined();
  });

  it('narrows to the shared source union', () => {
    const source: ScheduleVoteSource =
      ToggleScheduleVoteSchema.parse({ slotId: 1 }).source;
    expect(source).toBe('web');
  });
});

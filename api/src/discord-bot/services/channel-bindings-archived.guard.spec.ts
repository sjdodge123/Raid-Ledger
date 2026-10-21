/**
 * ROK-1428 Codex r11 P2 — the binding editor cannot take an ARCHIVED managed
 * binding out of the lifecycle (purpose change / game clear): the row would
 * keep its archived state and permission locks with nothing to unarchive it.
 */
import { BadRequestException } from '@nestjs/common';
import { buildBindingUpdateSet } from './channel-bindings-invariant.helpers';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  ARCHIVED_REROUTE_REFUSED,
  bindingUpdateWhere,
} from './channel-bindings-archived.guard';

const ARCHIVED = {
  config: null,
  bindingPurpose: 'game-announcements',
  gameId: 7,
  autoManaged: true,
  lifecycleState: 'archived',
};

function refusal(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return 'no throw';
}

describe('archived binding edits (Codex r11 P2)', () => {
  it('refuses a purpose change to quick-play-announcements', () => {
    const err = refusal(() =>
      buildBindingUpdateSet(ARCHIVED, {}, 'quick-play-announcements', {
        bindingPurpose: 'quick-play-announcements',
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(ARCHIVED_REROUTE_REFUSED);
  });

  it('refuses clearing the game', () => {
    const err = refusal(() =>
      buildBindingUpdateSet(ARCHIVED, {}, undefined, {
        gameIdProvided: true,
        gameId: null,
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(ARCHIVED_REROUTE_REFUSED);
  });

  it('still allows a config-only edit or a reassign to another game', () => {
    expect(() =>
      buildBindingUpdateSet(ARCHIVED, {}, undefined, {
        gameIdProvided: true,
        gameId: 9,
      }),
    ).not.toThrow();
    expect(() =>
      buildBindingUpdateSet(ARCHIVED, {}, undefined, {}),
    ).not.toThrow();
  });

  it('lets an ACTIVE binding change purpose', () => {
    const active = { ...ARCHIVED, lifecycleState: 'active' };
    expect(() =>
      buildBindingUpdateSet(active, {}, 'quick-play-announcements', {
        bindingPurpose: 'quick-play-announcements',
      }),
    ).not.toThrow();
  });
});

/** Codex r12 P2 — the UPDATE's atomic archived guard, rendered to SQL. */
describe('bindingUpdateWhere (Codex r12 P2)', () => {
  const render = (patch: Parameters<typeof bindingUpdateWhere>[1]): string => {
    const where = bindingUpdateWhere('b-1', patch);
    if (!where) throw new Error('no WHERE built');
    return new PgDialect().sqlToQuery(where).sql;
  };

  it('a config-only patch filters by id only', () => {
    expect(render({})).not.toContain('lifecycle_state');
  });

  it('a purpose change out of announcements requires a non-archived row', () => {
    const sql = render({ bindingPurpose: 'quick-play-announcements' });
    expect(sql).toContain(`"lifecycle_state" <> 'archived'`);
    expect(sql).not.toContain(' OR ');
  });

  it('a game re-point keeps eligibility only if the stored purpose does', () => {
    const sql = render({ gameIdProvided: true, gameId: 9 });
    expect(sql).toContain(
      `("channel_bindings"."lifecycle_state" <> 'archived' OR ("channel_bindings"."binding_purpose" = 'game-announcements'))`,
    );
  });

  it('a lifecycle-eligible re-point is unconstrained', () => {
    const sql = render({
      bindingPurpose: 'game-announcements',
      gameIdProvided: true,
      gameId: 9,
    });
    expect(sql).not.toContain('lifecycle_state');
  });
});

/**
 * ROK-1428 Codex r11 P2 — the binding editor cannot take an ARCHIVED managed
 * binding out of the lifecycle (purpose change / game clear): the row would
 * keep its archived state and permission locks with nothing to unarchive it.
 */
import { BadRequestException } from '@nestjs/common';
import { buildBindingUpdateSet } from './channel-bindings-invariant.helpers';
import { ARCHIVED_REROUTE_REFUSED } from './channel-bindings-archived.guard';

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

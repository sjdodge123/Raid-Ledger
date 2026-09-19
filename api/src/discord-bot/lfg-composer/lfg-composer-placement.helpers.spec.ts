/**
 * ROK-1612 AC1 — the composer stays last, once per burst, never twice.
 */
import {
  LFG_COMPOSER_REPOST_DEBOUNCE_MS,
  decideComposerPlacement,
  orphanComposerIds,
  type ComposerPlacement,
} from './lfg-composer-placement.helpers';

const BASE: ComposerPlacement = {
  composerMessageId: 'composer-1',
  lastMessageId: 'composer-1',
  lastRepostAt: null,
  now: 1_000_000,
};

describe('decideComposerPlacement', () => {
  it('does nothing while the composer is already the last message', () => {
    expect(decideComposerPlacement(BASE)).toEqual({
      repost: false,
      reason: 'already-last',
    });
  });

  it('reposts once chatter has pushed the composer up', () => {
    expect(
      decideComposerPlacement({ ...BASE, lastMessageId: 'chatter-9' }),
    ).toEqual({ repost: true, reason: 'not-last' });
  });

  it('collapses a burst of chatter into one repost', () => {
    const decision = decideComposerPlacement({
      ...BASE,
      lastMessageId: 'chatter-9',
      lastRepostAt: BASE.now - (LFG_COMPOSER_REPOST_DEBOUNCE_MS - 1),
    });
    expect(decision).toEqual({ repost: false, reason: 'debounced' });
  });

  it('reposts again once the debounce window has elapsed', () => {
    const decision = decideComposerPlacement({
      ...BASE,
      lastMessageId: 'chatter-9',
      lastRepostAt: BASE.now - LFG_COMPOSER_REPOST_DEBOUNCE_MS,
    });
    expect(decision).toEqual({ repost: true, reason: 'not-last' });
  });
});

describe('decideComposerPlacement — the invariants it exists to hold', () => {
  it('posts a MISSING composer even inside the debounce window', () => {
    const decision = decideComposerPlacement({
      ...BASE,
      composerMessageId: null,
      lastMessageId: 'chatter-9',
      lastRepostAt: BASE.now - 1,
    });
    expect(decision).toEqual({ repost: true, reason: 'missing' });
  });

  it('never races the board’s own re-render into a duplicate', () => {
    const decision = decideComposerPlacement({
      ...BASE,
      composerMessageId: null,
      lastMessageId: 'chatter-9',
      renderInFlight: true,
    });
    expect(decision).toEqual({ repost: false, reason: 'render-in-flight' });
  });

  it('writes nothing at all to a guild that declined the composer', () => {
    const decision = decideComposerPlacement({
      ...BASE,
      composerMessageId: null,
      lastMessageId: 'chatter-9',
      enabled: false,
    });
    expect(decision).toEqual({ repost: false, reason: 'disabled' });
  });

  it('treats an empty channel with no composer as a post, not a no-op', () => {
    const decision = decideComposerPlacement({
      ...BASE,
      composerMessageId: null,
      lastMessageId: null,
    });
    expect(decision).toEqual({ repost: true, reason: 'missing' });
  });
});

describe('orphanComposerIds', () => {
  it('sweeps every composer but the tracked one — exactly one survives', () => {
    const authored = [{ id: 'c-3' }, { id: 'c-2' }, { id: 'c-1' }];
    expect(orphanComposerIds(authored, 'c-3')).toEqual(['c-2', 'c-1']);
  });

  it('sweeps all of them when nothing is being kept', () => {
    expect(orphanComposerIds([{ id: 'c-2' }, { id: 'c-1' }], null)).toEqual([
      'c-2',
      'c-1',
    ]);
  });

  it('finds nothing to sweep in the healthy single-composer case', () => {
    expect(orphanComposerIds([{ id: 'c-1' }], 'c-1')).toEqual([]);
  });
});

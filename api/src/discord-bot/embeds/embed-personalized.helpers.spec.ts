/**
 * ROK-1459 (slice A) — DM-only personalized fields.
 *
 * COMPILE-TIME half of AC3. This file FAILS BY CONSTRUCTION today: neither
 * `embed-personalized.helpers.ts` nor `embed-chrome.helpers.ts` exists, so
 * ts-jest cannot compile it at all.
 *
 * After the module lands, the `@ts-expect-error` line below is the actual
 * assertion: if `addPersonalizedFields` ever stops rejecting a `ChannelEmbed`,
 * the suppression becomes unused and ts-jest (and `tsc --noEmit`) fail with
 * "Unused '@ts-expect-error' directive". Do NOT relax it to `@ts-ignore` —
 * that would silently delete the guard.
 */
import {
  applyEmbedChrome,
  createChannelEmbed,
  createDmEmbed,
} from './embed-chrome.helpers';
import {
  addPersonalizedFields,
  PERSONALIZED_FIELD_NAMES,
  type PersonalizedKind,
} from './embed-personalized.helpers';

const KINDS: PersonalizedKind[] = ['owned', 'wishlist', 'hearted'];

/** Tolerant of a Set or a readonly array — both are iterable. */
function personalizedNames(): string[] {
  return [...(PERSONALIZED_FIELD_NAMES as Iterable<string>)];
}

function dmEmbed() {
  return createDmEmbed({ state: 'announcing', communityName: 'Night Owls' });
}

describe('PERSONALIZED_FIELD_NAMES', () => {
  it('exposes at least one canonical marker name', () => {
    expect(personalizedNames().length).toBeGreaterThan(0);
  });
});

describe('addPersonalizedFields on a DmEmbed (AC3)', () => {
  it.each(KINDS)('lands a %s field on the embed', (kind) => {
    const embed = dmEmbed();
    const before = embed.toJSON().fields?.length ?? 0;

    const result = addPersonalizedFields(embed, [
      { kind, name: personalizedNames()[0], value: 'Half-Life 3' },
    ]);

    const fields = result.toJSON().fields ?? [];
    expect(fields).toHaveLength(before + 1);
    expect(fields[before].value).toBe('Half-Life 3');
  });

  it('only ever emits names the runtime chrome guard knows about', () => {
    const known = new Set(personalizedNames());
    const result = addPersonalizedFields(
      dmEmbed(),
      KINDS.map((kind) => ({
        kind,
        name: personalizedNames()[0],
        value: `${kind} value`,
      })),
    );

    const emitted = (result.toJSON().fields ?? []).map((f) => f.name);
    expect(emitted).toHaveLength(KINDS.length);
    for (const name of emitted) {
      expect(known.has(name)).toBe(true);
    }
  });

  it('honours the inline flag', () => {
    const result = addPersonalizedFields(dmEmbed(), [
      {
        kind: 'owned',
        name: personalizedNames()[0],
        value: 'Yes',
        inline: true,
      },
    ]);
    expect((result.toJSON().fields ?? [])[0].inline).toBe(true);
  });

  it('is a no-op for an empty field list', () => {
    const result = addPersonalizedFields(dmEmbed(), []);
    expect(result.toJSON().fields ?? []).toHaveLength(0);
  });
});

describe('addPersonalizedFields rejects a ChannelEmbed (AC3 compile-time)', () => {
  it('is a type error, and the forced call trips the runtime chrome guard', () => {
    const channelEmbed = createChannelEmbed({
      state: 'announcing',
      communityName: 'Night Owls',
    });

    // @ts-expect-error — a ChannelEmbed must not be assignable to DmEmbed.
    addPersonalizedFields(channelEmbed, [
      { kind: 'owned', name: personalizedNames()[0], value: 'Half-Life 3' },
    ]);

    // The phantom type is the real guard; belt-and-braces, re-chroming the
    // now-contaminated embed as a channel embed must throw.
    expect(() =>
      applyEmbedChrome(channelEmbed, {
        surface: 'channel',
        state: 'announcing',
        communityName: 'Night Owls',
      }),
    ).toThrow(/personalized field on channel embed/i);
  });
});

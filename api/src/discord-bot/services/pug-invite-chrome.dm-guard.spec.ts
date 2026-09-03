/**
 * ROK-1462 (slice D) AC4 — personalized fields are reachable ONLY from the DM
 * path of the invite family.
 *
 * Two halves, and both must stay:
 *  - COMPILE time: the `@ts-expect-error` below fails the build if a channel
 *    embed ever becomes assignable to `addPersonalizedFields`. If you delete
 *    the guard, tsc reports "Unused '@ts-expect-error' directive" and this file
 *    stops compiling — which is the point. Never relax it to `@ts-ignore`.
 *  - WRITE time: `applyEmbedChrome({ surface: 'channel' })` refuses to chrome an
 *    embed that already carries a DM-only field, so a builder cannot smuggle
 *    one in after the fact.
 */
import {
  applyEmbedChrome,
  createChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { addPersonalizedFields } from '../embeds/embed-personalized.helpers';
import { createInviteDmEmbed } from './pug-invite-chrome.helpers';

const OWNED = {
  kind: 'owned',
  name: '\u{1F3AE} In your library',
  value: '142 hrs played',
} as const;

function dmEmbed() {
  return createInviteDmEmbed({
    state: 'needs_you',
    authorLine: '◌ FILL NEEDED · starts in 40 min',
    communityName: 'Test Guild',
  });
}

describe('invite DM personalization guard (AC4)', () => {
  it('accepts the invite chrome DM embed', () => {
    const embed = dmEmbed();
    addPersonalizedFields(embed, [OWNED]);

    expect((embed.toJSON().fields ?? [])[0]).toMatchObject({
      name: '\u{1F3AE} In your library',
      value: '142 hrs played',
    });
  });

  it('refuses a channel embed at COMPILE time, and catches a forced one', () => {
    const channel = createChannelEmbed({
      state: 'needs_you',
      communityName: 'Test Guild',
    });

    // @ts-expect-error — a ChannelEmbed is not assignable to DmEmbed. The call
    // only compiles because this directive forces it; that IS the guard.
    addPersonalizedFields(channel, [OWNED]);

    // Forced past the type, the write-time half still refuses the result.
    expect(() =>
      applyEmbedChrome(channel, { surface: 'channel', state: 'needs_you' }),
    ).toThrow(/personalized field on channel embed/i);
  });

  it('refuses to re-chrome a personalized DM embed onto a channel', () => {
    const embed = dmEmbed();
    addPersonalizedFields(embed, [OWNED]);

    expect(() =>
      applyEmbedChrome(embed, { surface: 'channel', state: 'needs_you' }),
    ).toThrow(/personalized field on channel embed/i);
  });
});

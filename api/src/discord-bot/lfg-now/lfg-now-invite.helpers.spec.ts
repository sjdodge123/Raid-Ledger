/**
 * ROK-2352 P1-3 — a keyed Start now invite links and joins THAT group.
 */
import { buildLiveSessionInvite } from './lfg-now-invite.helpers';

const GAME = { id: 3, name: 'WoW', slug: 'wow' };
const CLIENT = 'https://rl.test';

describe('buildLiveSessionInvite (ROK-2352 P1-3)', () => {
  it('carries the keyed group in the payload and links its page', () => {
    // MUTATION: drop the groupKey argument to buildLfgInviteUrl and the url
    // reads https://rl.test/lfg/wow; drop the payload spread and groupKey is
    // missing (the Join button would raise a hand in the Any group).
    const body = buildLiveSessionInvite(GAME, 7, 'Ann', CLIENT, 'dungeon:36');
    expect(body.payload).toMatchObject({
      groupKey: 'dungeon:36',
      url: `${CLIENT}/lfg/wow/dungeon%3A36`,
    });
  });

  it('keeps the Any group invite unkeyed, linking the game page', () => {
    const body = buildLiveSessionInvite(GAME, 7, 'Ann', CLIENT);
    expect(body.payload).not.toHaveProperty('groupKey');
    expect(body.payload).toMatchObject({ url: `${CLIENT}/lfg/wow` });
  });
});

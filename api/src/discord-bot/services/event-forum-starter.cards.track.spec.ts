/**
 * ROK-2292 Codex P2 — `track` settles a starter a creator JUST posted against
 * a cancel/delete that landed while the Discord create was in flight (the
 * lifecycle handler could not see the post: no row yet). Deleted → nothing
 * recorded, no FK throw; cancelled → the button-free cancelled card.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { EMBED_STATES } from '../discord-bot.constants';
import { EventForumStarterCards } from './event-forum-starter.cards';

jest.mock('../processors/embed-sync.helpers', () => ({
  buildEventData: jest.fn().mockResolvedValue({ id: 1 }),
  computeEmbedState: jest.fn(),
}));
jest.mock('../channel-lifecycle/hub-link.resolver', () => ({
  resolveGameHubLinkSafe: jest.fn().mockResolvedValue(null),
}));

const THREAD = '900';
const CANCELLED_CARD = { embed: { title: 'cancelled' } };

function setup() {
  const db: MockDb = createDrizzleMock();
  const client = { getGuildId: jest.fn().mockReturnValue('g1') };
  const factory = {
    buildEventCancelled: jest.fn().mockReturnValue(CANCELLED_CARD),
  };
  const settings = {
    getBranding: jest.fn().mockResolvedValue({ communityName: 'C' }),
    getClientUrl: jest.fn().mockResolvedValue('https://x'),
    getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
  };
  const editor = { edit: jest.fn().mockResolvedValue('edited') };
  const cards = new EventForumStarterCards(
    db as never,
    client as never,
    factory as never,
    {} as never,
    settings as never,
    {} as never,
    editor as never,
  );
  return { db, factory, editor, cards };
}

const fkError = () =>
  Object.assign(new Error('insert failed'), { cause: { code: '23503' } });

describe('ROK-2292 EventForumStarterCards.track', () => {
  it('event deleted mid-create: the FK violation is swallowed, nothing else runs', async () => {
    const { db, cards, editor } = setup();
    db.onConflictDoNothing.mockRejectedValueOnce(fkError());
    await expect(
      cards.track(1, THREAD, EMBED_STATES.POSTED),
    ).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
    expect(editor.edit).not.toHaveBeenCalled();
  });

  it('any other insert failure still throws', async () => {
    const { db, cards } = setup();
    db.onConflictDoNothing.mockRejectedValueOnce(new Error('db down'));
    await expect(cards.track(1, THREAD, EMBED_STATES.POSTED)).rejects.toThrow(
      'db down',
    );
  });

  it('event cancelled mid-create: the starter gets the cancelled card and state', async () => {
    const { db, cards, editor, factory } = setup();
    db.onConflictDoNothing.mockResolvedValueOnce(undefined);
    db.limit.mockResolvedValueOnce([{ id: 1, cancelledAt: new Date() }]);
    // the starter row lookup (select … where, no limit)
    db.where.mockReturnValueOnce(db).mockResolvedValueOnce([{ id: 77 }]);
    await cards.track(1, THREAD, EMBED_STATES.POSTED);
    expect(factory.buildEventCancelled).toHaveBeenCalledTimes(1);
    expect(editor.edit).toHaveBeenCalledWith(
      { id: 77, channelId: THREAD, messageId: THREAD },
      CANCELLED_CARD,
    );
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.CANCELLED }),
    );
  });

  it('event still live: recorded with the built state, no edit', async () => {
    const { db, cards, editor } = setup();
    db.onConflictDoNothing.mockResolvedValueOnce(undefined);
    db.limit.mockResolvedValueOnce([{ id: 1, cancelledAt: null }]);
    await cards.track(1, THREAD, EMBED_STATES.FILLING);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: THREAD,
        messageId: THREAD,
        embedState: EMBED_STATES.FILLING,
      }),
    );
    expect(editor.edit).not.toHaveBeenCalled();
  });
});

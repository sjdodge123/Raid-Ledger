/**
 * ROK-2204 — a launcher (CurseForge, Overwolf, ...) listed before the bound
 * game must not hide that game from the fixed-game monitor's presence
 * recheck: the "same game as before" short-circuit compares GAMES only.
 */
import { ActivityType, type GuildMember, type Presence } from 'discord.js';
import {
  handlePresenceUpdate,
  type JoinHandlerCtx,
} from './voice-state-join-dispatch.handlers';
import type { ResolvedBinding } from './voice-state.helpers';

const BG3 = { gameId: 1, gameName: "Baldur's Gate 3" };

const bg3Monitor: ResolvedBinding = {
  bindingId: 'bind-game',
  gameId: BG3.gameId,
  gameName: BG3.gameName,
  bindingPurpose: 'game-voice-monitor',
  recurrenceGroupId: null,
  config: { minPlayers: 2 },
};

const presence = (...names: string[]): Presence =>
  ({
    activities: names.map((name) => ({ type: ActivityType.Playing, name })),
  }) as unknown as Presence;

const member = (...names: string[]): GuildMember =>
  ({
    id: 'u1',
    user: { bot: false },
    presence: presence(...names),
  }) as unknown as GuildMember;

function ctxFor(): { ctx: JoinHandlerCtx; detect: jest.Mock } {
  const detect = jest.fn().mockResolvedValue({ gameId: 99, gameName: 'x' });
  const svc = {
    getActiveBindingEventGameId: jest.fn().mockReturnValue(null),
    getActiveState: jest.fn(),
  };
  const ctx = {
    deps: { adHocEventService: svc },
    presenceDetector: { detectGameForMember: detect },
    resolveAllBindings: jest.fn().mockResolvedValue([bg3Monitor]),
  } as unknown as JoinHandlerCtx;
  return { ctx, detect };
}

describe('ROK-2204 — monitor presence recheck skips launchers', () => {
  it('starting the bound game next to an open launcher is re-detected', async () => {
    const { ctx, detect } = ctxFor();
    const gm = member('CurseForge', BG3.gameName);
    await handlePresenceUpdate(ctx, 'ch', gm, presence('CurseForge'));
    expect(detect).toHaveBeenCalledWith(gm);
  });

  it('a launcher-only presence triggers no game detection', async () => {
    const { ctx, detect } = ctxFor();
    await handlePresenceUpdate(ctx, 'ch', member('Overwolf'), null);
    expect(detect).not.toHaveBeenCalled();
  });

  it('opening a launcher next to the same game triggers no detection', async () => {
    const { ctx, detect } = ctxFor();
    const gm = member('CurseForge', BG3.gameName);
    await handlePresenceUpdate(ctx, 'ch', gm, presence(BG3.gameName));
    expect(detect).not.toHaveBeenCalled();
  });
});

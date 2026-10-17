/**
 * Unit tests for handleExistingSignup — Sign Up re-click heals the 'pending'
 * confirmationStatus left by the ROK-1269 reschedule reset (characterless
 * games have no other recovery affordance).
 */
import { handleExistingSignup } from './signup-signup.handlers';
import { createMockDeps } from './signup-handlers.spec-helpers';
import type { ButtonInteraction } from 'discord.js';

const EVENT_ID = 104;
const DISCORD_ID = 'discord-user-1';

type ExistingSignup = Parameters<typeof handleExistingSignup>[2];

function makeExistingSignup(
  confirmationStatus: 'pending' | 'confirmed',
): ExistingSignup {
  return {
    id: 7,
    eventId: EVENT_ID,
    status: 'signed_up',
    confirmationStatus,
    user: { id: 42, discordId: DISCORD_ID, username: 'Tester', avatar: null },
    discordUserId: null,
    characterId: null,
    character: null,
    note: null,
    signedUpAt: new Date().toISOString(),
  } as unknown as ExistingSignup;
}

function makeInteraction(): ButtonInteraction {
  return {
    editReply: jest.fn().mockResolvedValue(undefined),
    user: { id: DISCORD_ID },
  } as unknown as ButtonInteraction;
}

function selectOnce(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function setupDeps(assignedRole: string | null = 'player') {
  const deps = createMockDeps();
  const setCalls: Array<Record<string, unknown>> = [];
  const db = deps.db as unknown as {
    select: jest.Mock;
    update: jest.Mock;
  };
  // #1 findLinkedUser, #2 loadGameContext event (generic game, no gameId →
  // null context → no selection UI → heal branch reachable), #3
  // reconfirmPendingWithSlot → getAssignedSlotRole (non-bench → heal fires).
  db.select
    .mockReturnValueOnce(selectOnce([{ id: 42, discordId: DISCORD_ID }]))
    .mockReturnValueOnce(
      selectOnce([
        {
          id: EVENT_ID,
          title: 'D&D Night',
          slotConfig: { type: 'generic', player: 5 },
          gameId: null,
        },
      ]),
    )
    .mockReturnValueOnce(
      selectOnce(assignedRole ? [{ role: assignedRole }] : []),
    );
  db.update = jest.fn().mockReturnValue({
    set: jest.fn().mockImplementation((vals: Record<string, unknown>) => {
      setCalls.push(vals);
      return { where: jest.fn().mockResolvedValue(undefined) };
    }),
  });
  return { deps, setCalls, db };
}

describe('handleExistingSignup — pending-confirmation heal', () => {
  it('re-confirms a pending active signup on Sign Up re-click', async () => {
    const { deps, setCalls } = setupDeps();
    const interaction = makeInteraction();

    await handleExistingSignup(
      interaction,
      EVENT_ID,
      makeExistingSignup('pending'),
      deps,
    );

    expect(setCalls).toEqual([{ confirmationStatus: 'confirmed' }]);
    expect(deps.activityLog.log).toHaveBeenCalledWith(
      'event',
      EVENT_ID,
      'signup_reconfirmed',
      42,
      { reason: 'discord-signup-reassert' },
    );
    const reply = (interaction.editReply as jest.Mock).mock.calls[0][0] as {
      content: string;
    };
    expect(reply.content).toMatch(/confirmed/i);
    expect(reply.content).not.toMatch(/already signed up/i);
  });

  it('does NOT confirm a benched pending signup (parity with web heal)', async () => {
    const { deps, setCalls } = setupDeps('bench');
    const interaction = makeInteraction();

    await handleExistingSignup(
      interaction,
      EVENT_ID,
      makeExistingSignup('pending'),
      deps,
    );

    expect(setCalls).toEqual([]);
    expect(deps.activityLog.log).not.toHaveBeenCalled();
    const reply = (interaction.editReply as jest.Mock).mock.calls[0][0] as {
      content: string;
    };
    expect(reply.content).toMatch(/already signed up/i);
  });

  it('keeps the already-signed-up copy when nothing needed healing', async () => {
    const { deps, setCalls } = setupDeps();
    const interaction = makeInteraction();

    await handleExistingSignup(
      interaction,
      EVENT_ID,
      makeExistingSignup('confirmed'),
      deps,
    );

    expect(setCalls).toEqual([]);
    expect(deps.activityLog.log).not.toHaveBeenCalled();
    const reply = (interaction.editReply as jest.Mock).mock.calls[0][0] as {
      content: string;
    };
    expect(reply.content).toMatch(/already signed up/i);
  });
});

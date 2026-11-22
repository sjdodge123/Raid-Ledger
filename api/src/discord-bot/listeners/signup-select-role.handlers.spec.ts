/**
 * ROK-1728 review MINOR 3: a Discord "sign up as tentative" click writes one
 * activity row. signup() audits the row, so the follow-up tentative flip
 * opts out of its own `signup_status_changed` row.
 */
import type { StringSelectMenuInteraction } from 'discord.js';
import {
  handleUnlinkedRoleSelect,
  signupWithCharacter,
} from './signup-select-role.handlers';
import { createMockDeps } from './signup-handlers.spec-helpers';

describe('signupWithCharacter — tentative', () => {
  it('flips to tentative without a second audit row', async () => {
    const deps = createMockDeps();
    await signupWithCharacter(deps, 10, 42, 'char-1', {}, 'tentative');
    expect(deps.signupsService.signup).toHaveBeenCalledWith(10, 42, {});
    expect(deps.signupsService.updateStatus).toHaveBeenCalledWith(
      10,
      { userId: 42 },
      { status: 'tentative' },
      { audit: false },
    );
  });

  it('does not touch the status for a plain sign-up', async () => {
    const deps = createMockDeps();
    await signupWithCharacter(deps, 10, 42, 'char-1', {});
    expect(deps.signupsService.updateStatus).not.toHaveBeenCalled();
  });
});

const TRUSTED = 'https://raid.example';
const ROLE_CTX = {
  selectedRoles: ['dps' as const],
  primaryRole: 'dps' as const,
  rolesLabel: 'DPS',
};

function chain(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function makeMenuInteraction() {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    user: { id: 'discord-9', username: 'Anon', avatar: null },
    editReply,
  } as unknown as StringSelectMenuInteraction;
  return { interaction, editReply };
}

function lastContent(editReply: jest.Mock): string | undefined {
  const reply = editReply.mock.calls.at(-1)?.[0] as
    { content?: string } | undefined;
  return reply?.content;
}

function withEnvClientUrl(value: string, run: () => Promise<void>) {
  return async () => {
    const original = process.env.CLIENT_URL;
    process.env.CLIENT_URL = value;
    try {
      await run();
    } finally {
      if (original === undefined) delete process.env.CLIENT_URL;
      else process.env.CLIENT_URL = original;
    }
  };
}

describe('handleUnlinkedRoleSelect — zero-character Tip (ROK-2294)', () => {
  it(
    'points the Tip at the trusted characters panel for the game, not raw env',
    withEnvClientUrl('http://localhost:5173', async () => {
      const deps = createMockDeps();
      (deps.settingsService.getTrustedClientUrl as jest.Mock).mockResolvedValue(
        TRUSTED,
      );
      (deps.db.select as jest.Mock)
        .mockReturnValueOnce(chain([{ id: 42, discordId: 'discord-9' }]))
        .mockReturnValueOnce(chain([{ id: 10, title: 'Raid', gameId: 1 }]));
      const { interaction, editReply } = makeMenuInteraction();

      await handleUnlinkedRoleSelect(interaction, 10, deps, ROLE_CTX);

      const content = lastContent(editReply);
      expect(content).toContain(
        `Tip: Create a character at ${TRUSTED}/profile/gaming/characters?game=1`,
      );
      expect(content).not.toContain('localhost');
    }),
  );
});

describe('handleUnlinkedRoleSelect — anonymous account link (ROK-1627)', () => {
  function anonymousDeps(trusted: string | null) {
    const deps = createMockDeps();
    (deps.settingsService.getTrustedClientUrl as jest.Mock).mockResolvedValue(
      trusted,
    );
    (deps.db.select as jest.Mock).mockReturnValueOnce(chain([]));
    const signupDiscord = jest.fn().mockResolvedValue({ assignedSlot: 'dps' });
    Object.assign(deps.signupsService, { signupDiscord });
    return deps;
  }

  it(
    'links "Create an account" to the trusted client URL',
    withEnvClientUrl('http://localhost:5173', async () => {
      const deps = anonymousDeps(TRUSTED);
      const { interaction, editReply } = makeMenuInteraction();

      await handleUnlinkedRoleSelect(interaction, 10, deps, ROLE_CTX);

      const content = lastContent(editReply);
      expect(content).toContain(`[Create an account](${TRUSTED})`);
      expect(content).not.toContain('localhost');
    }),
  );

  it(
    'omits the link when no trusted client URL is set, even with raw env set',
    withEnvClientUrl('http://localhost:5173', async () => {
      const deps = anonymousDeps(null);
      const { interaction, editReply } = makeMenuInteraction();

      await handleUnlinkedRoleSelect(interaction, 10, deps, ROLE_CTX);

      const content = lastContent(editReply);
      expect(content).toContain("You're signed up as **Anon** (DPS)!");
      expect(content).not.toContain('Create an account');
    }),
  );
});

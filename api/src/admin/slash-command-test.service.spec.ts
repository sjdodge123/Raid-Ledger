/**
 * ROK-1454 D10 — `/lfg` must be reachable through the DEMO_MODE slash-command
 * harness.
 *
 * `HANDLER_MAP` is what lets a smoke test drive a slash command without a live
 * Discord interaction token. AC10 step 3 raises the THIRD hand through this
 * harness, so a missing entry does not degrade the smoke run — it makes the
 * edit-in-place assertion (AC2) impossible to express at all.
 */
import { ModuleRef } from '@nestjs/core';
import { LfgCommand } from '../discord-bot/commands/lfg.command';
import type { SettingsService } from '../settings/settings.service';
import { SlashCommandTestService } from './slash-command-test.service';

/** A stand-in handler that records what the harness handed it. */
function stubHandler() {
  return {
    handleInteraction: jest.fn(async (interaction: { reply: (d: unknown) => Promise<void> }) => {
      await interaction.reply({ content: 'stub-handler-ran' });
    }),
    handleAutocomplete: jest.fn(
      async (interaction: {
        respond: (c: { name: string; value: unknown }[]) => Promise<void>;
      }) => {
        await interaction.respond([{ name: '📋 My groups', value: 'list' }]);
      },
    ),
  };
}

describe('SlashCommandTestService — HANDLER_MAP', () => {
  const originalDemoMode = process.env.DEMO_MODE;
  let service: SlashCommandTestService;
  let moduleRef: { get: jest.Mock };
  let handler: ReturnType<typeof stubHandler>;

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
    handler = stubHandler();
    moduleRef = { get: jest.fn().mockReturnValue(handler) };
    const settings = {
      getDemoMode: jest.fn().mockResolvedValue(true),
    } as unknown as SettingsService;
    service = new SlashCommandTestService(
      moduleRef as unknown as ModuleRef,
      settings,
    );
  });

  afterEach(() => {
    process.env.DEMO_MODE = originalDemoMode;
  });

  it('routes commandName "lfg" to the LfgCommand provider', async () => {
    const res = await service.executeCommand({
      commandName: 'lfg',
      options: { game: '42' },
      discordUserId: 'discord-lfg-1',
    });

    expect(res).toMatchObject({ content: 'stub-handler-ran' });
    expect(moduleRef.get).toHaveBeenCalledWith(LfgCommand, { strict: false });
  });

  it('routes /lfg autocomplete so the list sentinel is observable', async () => {
    const res = await service.executeAutocomplete({
      commandName: 'lfg',
      focusedOption: 'game',
      value: '',
    });

    expect(res.choices).toEqual([{ name: '📋 My groups', value: 'list' }]);
    expect(moduleRef.get).toHaveBeenCalledWith(LfgCommand, { strict: false });
  });

  it('still rejects a command name that is not in the map', async () => {
    await expect(
      service.executeCommand({ commandName: 'definitely-not-a-command' }),
    ).rejects.toThrow('Unknown command: definitely-not-a-command');
  });
});

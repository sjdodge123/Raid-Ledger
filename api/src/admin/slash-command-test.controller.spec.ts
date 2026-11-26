/**
 * ROK-2283 — unit: the DEMO_MODE `/login` rate-limit reset the companion
 * smoke calls before it runs `/login`.
 */
import { BadRequestException } from '@nestjs/common';
import { SlashCommandTestController } from './slash-command-test.controller';
import type { SlashCommandTestService } from './slash-command-test.service';

const SNOWFLAKE = '123456789012345678';

function build(): { ctrl: SlashCommandTestController; del: jest.Mock } {
  const del = jest.fn().mockResolvedValue(1);
  const ctrl = new SlashCommandTestController({} as SlashCommandTestService, {
    del,
  });
  return { ctrl, del };
}

describe('SlashCommandTestController.clearLoginRateLimit', () => {
  it("deletes the member's signin-link:rl and signin-code:rl keys (ROK-2370)", async () => {
    const { ctrl, del } = build();
    await ctrl.clearLoginRateLimit(SNOWFLAKE);
    expect(del).toHaveBeenCalledWith(
      `signin-link:rl:${SNOWFLAKE}`,
      `signin-code:rl:${SNOWFLAKE}`,
    );
  });

  it('400s a non-snowflake id and touches nothing', async () => {
    const { ctrl, del } = build();
    await expect(ctrl.clearLoginRateLimit('signin-link:*')).rejects.toThrow(
      BadRequestException,
    );
    expect(del).not.toHaveBeenCalled();
  });
});

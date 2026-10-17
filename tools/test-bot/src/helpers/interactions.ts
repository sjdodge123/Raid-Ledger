/**
 * Interaction helpers for the test companion bot.
 *
 * KNOWN LIMITATION: Discord API does not allow bots to click buttons or
 * interact with message components on other bots' messages. The API returns
 * "Interaction failed" because component interactions are scoped to the
 * message's application (the bot that sent it).
 *
 * Workarounds:
 * 1. Use the MCP/CDP approach (tools/mcp-discord) to click buttons via the UI
 * 2. Test interaction handlers directly in integration tests by calling the
 *    NestJS interaction handler with a mocked ButtonInteraction
 * 3. Use a user account (against Discord ToS — not recommended)
 *
 * The functions below are STUBS documenting the intended API for when/if
 * Discord relaxes this limitation or we find an alternative approach.
 */

export async function clickButton(
  _channelId: string,
  _messageId: string,
  _buttonLabel: string,
): Promise<void> {
  throw new Error(
    'Not supported: Discord API does not allow bots to click other bots\' buttons. ' +
      'Use the MCP Discord tool (tools/mcp-discord) for UI-level button clicks, ' +
      'or test interaction handlers directly in integration tests.',
  );
}

export async function selectDropdownOption(
  _channelId: string,
  _messageId: string,
  _value: string,
): Promise<void> {
  throw new Error(
    'Not supported: Discord API does not allow bots to interact with other bots\' select menus. ' +
      'Use the MCP Discord tool (tools/mcp-discord) for UI-level interactions, ' +
      'or test interaction handlers directly in integration tests.',
  );
}

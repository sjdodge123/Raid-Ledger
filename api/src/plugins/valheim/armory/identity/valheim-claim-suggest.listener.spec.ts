/**
 * ROK-2356 — the claim-DM buttons are inert while the Valheim plugin is off:
 * the press is acknowledged, only the clicker is told, and nothing is read or
 * written. With Valheim on the press runs its normal path.
 */
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { CLAIM_REPLY_COPY } from './valheim-claim-suggest.copy';
import { ValheimClaimSuggestListener } from './valheim-claim-suggest.listener';
import { findAskedClicker } from './valheim-claim-suggest-reply.helpers';

jest.mock('./valheim-claim-suggest-reply.helpers', () => ({
  ...jest.requireActual<object>('./valheim-claim-suggest-reply.helpers'),
  findAskedClicker: jest.fn(),
}));

function harness(active: boolean) {
  const claims = { claim: jest.fn() };
  const registry = { isActive: jest.fn(() => active) };
  const deps = [
    {},
    {},
    claims,
    { summary: jest.fn(), assertCharacterVisible: jest.fn() },
    { checkAndMarkSent: jest.fn(), releaseKey: jest.fn() },
    {},
    registry,
  ] as unknown as ConstructorParameters<typeof ValheimClaimSuggestListener>;
  const interaction = {
    customId: 'vclaim:yes:5',
    user: { id: '111' },
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
  const listener = new ValheimClaimSuggestListener(...deps);
  const press = () =>
    listener.handleButtonInteraction(
      interaction as unknown as ButtonInteraction,
    );
  return { press, interaction, claims, registry };
}

afterEach(() => jest.resetAllMocks());

describe('ValheimClaimSuggestListener — Valheim turned off (ROK-2356)', () => {
  it('answers only the clicker and never resolves or claims', async () => {
    const h = harness(false);
    await h.press();
    expect(h.registry.isActive).toHaveBeenCalledWith('valheim');
    expect(h.interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(h.interaction.followUp).toHaveBeenCalledWith({
      content: CLAIM_REPLY_COPY.off,
      flags: MessageFlags.Ephemeral,
    });
    expect(h.interaction.editReply).not.toHaveBeenCalled();
    expect(findAskedClicker).not.toHaveBeenCalled();
    expect(h.claims.claim).not.toHaveBeenCalled();
  });

  it('runs the normal path while Valheim is on', async () => {
    jest.mocked(findAskedClicker).mockResolvedValue(null);
    const h = harness(true);
    await h.press();
    expect(findAskedClicker).toHaveBeenCalledTimes(1);
    expect(h.interaction.followUp).toHaveBeenCalledWith({
      content: CLAIM_REPLY_COPY.notForYou,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('ignores a button that is not a claim button, on or off', async () => {
    const h = harness(false);
    h.interaction.customId = 'other:thing';
    await h.press();
    expect(h.interaction.deferUpdate).not.toHaveBeenCalled();
  });
});

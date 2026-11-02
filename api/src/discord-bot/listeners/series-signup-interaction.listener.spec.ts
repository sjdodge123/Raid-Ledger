import { MessageFlags } from 'discord.js';
import { SeriesSignupInteractionListener } from './series-signup-interaction.listener';
import { handleJoinSeries } from './series-signup-interaction.handlers';
import { handleSeriesSkip } from './series-signup-decline.handlers';

jest.mock('./series-signup-interaction.handlers', () => ({
  handleJoinSeries: jest.fn(),
  handleSeriesCharacterPick: jest.fn(),
  handleSeriesConfirm: jest.fn(),
  handleSeriesRolePick: jest.fn(),
}));
jest.mock('./series-signup-decline.handlers', () => ({
  handleSeriesLeave: jest.fn(),
  handleSeriesSkip: jest.fn(),
}));

function makeListener(): SeriesSignupInteractionListener {
  const ctorArgs = [{}, {}, {}, {}, {}, {}] as ConstructorParameters<
    typeof SeriesSignupInteractionListener
  >;
  return new SeriesSignupInteractionListener(...ctorArgs);
}

function button(customId: string): Record<string, jest.Mock | string> & {
  deferReply: jest.Mock;
  deferUpdate: jest.Mock;
  editReply: jest.Mock;
} {
  return {
    customId,
    isButton: jest.fn().mockReturnValue(true),
    isStringSelectMenu: jest.fn().mockReturnValue(false),
    deferReply: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('SeriesSignupInteractionListener', () => {
  it('ignores customIds that are not series_*', async () => {
    const i = button('signup:42');
    await makeListener().handleInteraction(i as never);
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it('opens an ephemeral reply for the embed Join Series button', async () => {
    const i = button('series_join:42');
    await makeListener().handleInteraction(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(handleJoinSeries).toHaveBeenCalledWith(i, 42, expect.any(Object));
  });

  it('edits the existing ephemeral for later steps (skip)', async () => {
    const i = button('series_skip:42');
    await makeListener().handleInteraction(i as never);
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(handleSeriesSkip).toHaveBeenCalledWith(i, 42, expect.any(Object));
  });

  it('replies with the generic error when a handler throws', async () => {
    (handleJoinSeries as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const i = button('series_join:42');
    await makeListener().handleInteraction(i as never);
    expect(i.editReply).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again.',
      components: [],
    });
  });
});

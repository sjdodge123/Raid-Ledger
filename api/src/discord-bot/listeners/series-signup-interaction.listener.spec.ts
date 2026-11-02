import { NotFoundException } from '@nestjs/common';
import { MessageFlags } from 'discord.js';
import { SeriesSignupInteractionListener } from './series-signup-interaction.listener';
import {
  handleJoinSeries,
  handleSeriesConfirm,
} from './series-signup-interaction.handlers';
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

function button(
  customId: string,
  discordUserId = 'discord-1',
): Record<string, jest.Mock | string> & {
  deferReply: jest.Mock;
  deferUpdate: jest.Mock;
  editReply: jest.Mock;
} {
  return {
    customId,
    user: { id: discordUserId } as never,
    isButton: jest.fn().mockReturnValue(true),
    isStringSelectMenu: jest.fn().mockReturnValue(false),
    deferReply: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Make the NEXT `handleSeriesConfirm` call hang until `finish()`; `started`
 * resolves once that call is running (i.e. the guard holds its key).
 */
function holdNextConfirm(): { started: Promise<void>; finish: () => void } {
  let finish: () => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = () => resolve();
  });
  (handleSeriesConfirm as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = () => resolve();
        markStarted();
      }),
  );
  return { started, finish: () => finish() };
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

  it('replies with the service message when a handler throws an HttpException', async () => {
    (handleJoinSeries as jest.Mock).mockRejectedValueOnce(
      new NotFoundException('Event not found'),
    );
    const i = button('series_join:42');
    await makeListener().handleInteraction(i as never);
    expect(i.editReply).toHaveBeenCalledWith({
      content: 'Event not found',
      components: [],
    });
  });

  it('drops a second Confirm while the first is still running, then accepts the next', async () => {
    let finish: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = () => resolve();
    });
    (handleSeriesConfirm as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => resolve();
          markStarted();
        }),
    );
    const listener = makeListener();
    const first = button('series_confirm:42:-:-');
    const second = button('series_confirm:42:-:-');
    const running = listener.handleInteraction(first as never);
    await started;
    await listener.handleInteraction(second as never);
    expect(second.deferUpdate).toHaveBeenCalled();
    expect(handleSeriesConfirm).toHaveBeenCalledTimes(1);
    expect(second.editReply).not.toHaveBeenCalled();
    finish();
    await running;
    await listener.handleInteraction(button('series_confirm:42:-:-') as never);
    expect(handleSeriesConfirm).toHaveBeenCalledTimes(2);
  });

  // A guard keyed on the event alone would drop this second user's Confirm.
  it('does not drop a different user Confirming the same event while the first is in flight', async () => {
    const held = holdNextConfirm();
    const listener = makeListener();
    const running = listener.handleInteraction(
      button('series_confirm:42:-:-', 'discord-1') as never,
    );
    await held.started;
    const other = button('series_confirm:42:-:-', 'discord-2');
    await listener.handleInteraction(other as never);
    expect(handleSeriesConfirm).toHaveBeenCalledTimes(2);
    expect(handleSeriesConfirm).toHaveBeenLastCalledWith(
      other,
      expect.objectContaining({ eventId: 42 }),
      expect.any(Object),
    );
    held.finish();
    await running;
  });

  // A guard that clears its key only on success would drop the retry.
  it('accepts a fresh Confirm from the same user after the first one rejected', async () => {
    (handleSeriesConfirm as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const listener = makeListener();
    const failed = button('series_confirm:42:-:-');
    await listener.handleInteraction(failed as never);
    expect(failed.editReply).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again.',
      components: [],
    });
    const retry = button('series_confirm:42:-:-');
    await listener.handleInteraction(retry as never);
    expect(handleSeriesConfirm).toHaveBeenCalledTimes(2);
    expect(handleSeriesConfirm).toHaveBeenLastCalledWith(
      retry,
      expect.objectContaining({ eventId: 42 }),
      expect.any(Object),
    );
  });
});

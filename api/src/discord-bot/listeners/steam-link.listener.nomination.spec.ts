/**
 * TDD tests for steam-link.listener.ts — paste-to-nominate (ROK-1081).
 *
 * Extends the ROK-966 heart flow: when an active Community Lineup is in
 * `building` status, pasting a Steam URL offers a 4-button nomination DM
 * (Nominate / Just Heart It / Always Auto-Nominate / Dismiss) instead of
 * the 3-button heart prompt.
 *
 * These tests MUST fail until the dev agent:
 *   1. Adds `findActiveBuildingLineup`, `isGameNominated`,
 *      `getAutoNominateSteamUrlsPref`, `setAutoNominateSteamUrlsPref` helpers
 *   2. Accepts `LineupsService` as a constructor dependency
 *   3. Dispatches the nomination flow when a building lineup exists
 *   4. Adds `STEAM_NOMINATE_BUTTON_IDS` constants and button handlers
 *
 * Shared setup lives in ./steam-link.listener.spec-helpers.ts.
 */
import {
  buildMockContext,
  callHandleMessage,
  callHandleButtonInteraction,
  createMessage,
  makeButtonInteraction,
  stubGameLookup,
  stubUserLookup,
  stubBuildingLineup,
  stubGameNominated,
  stubAutoNominatePref,
  type MockContext,
} from './steam-link.listener.spec-helpers';

let ctx: MockContext;

beforeEach(() => {
  ctx = buildMockContext();
});

describe('SteamLinkListener — nomination flow (ROK-1081)', () => {
  describe('AC-1 active building lineup check', () => {
    activeLineupTests();
  });

  describe('AC-3 already-nominated DM', () => {
    alreadyNominatedTests();
  });

  describe('AC-4 nomination prompt DM', () => {
    nominationPromptTests();
  });

  describe('AC-5 auto-nominate preference', () => {
    autoNominateTests();
  });

  describe('AC-6 cap reached (auto-nominate)', () => {
    nominationCapTests();
  });

  describe('button handlers — steam_nominate_*', () => {
    buttonHandlerTests();
  });
});

/**
 * AC-1: when a building lineup is active the nomination flow runs (DM
 * mentions Community Lineup); when no building lineup exists the existing
 * heart flow runs unchanged (regression — ROK-966).
 */
function activeLineupTests() {
  it('runs the nomination flow when a building lineup is active', async () => {
    stubGameLookup(ctx, { id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });
    stubGameNominated(ctx, false);
    stubAutoNominatePref(ctx, false);

    const msg = createMessage(
      ctx,
      'https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(ctx.listener, msg);

    expect(ctx.mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Community Lineup'),
      }),
    );
  });

  it('falls back to heart flow (no nomination copy) when no building lineup exists', async () => {
    stubGameLookup(ctx, { id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, null);
    // heart flow path: no existing interest, no auto-heart pref.
    ctx.mockDb.limit.mockResolvedValueOnce([]); // hasExistingHeartInterest
    ctx.mockDb.limit.mockResolvedValueOnce([]); // getAutoHeartSteamUrlsPref

    const msg = createMessage(
      ctx,
      'https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(ctx.listener, msg);

    const call = ctx.mockDmSend.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const content = call?.content ?? '';
    expect(content).not.toMatch(/Community Lineup/i);
    expect(content).not.toMatch(/nominate/i);
  });
}

/**
 * AC-3: building lineup + game already nominated — DM tells the user the
 * game is already nominated, with NO buttons.
 */
function alreadyNominatedTests() {
  it('sends a DM with the already-nominated copy and no buttons', async () => {
    stubGameLookup(ctx, { id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });
    stubGameNominated(ctx, true);

    const msg = createMessage(
      ctx,
      'https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(ctx.listener, msg);

    expect(ctx.mockDmSend).toHaveBeenCalledTimes(1);
    const call = ctx.mockDmSend.mock.calls[0]?.[0] as {
      content?: string;
      components?: unknown[];
    };
    expect(call?.content).toContain(
      '**Counter-Strike 2** is already nominated for the current lineup.',
    );
    const hasComponents =
      Array.isArray(call?.components) && (call?.components?.length ?? 0) > 0;
    expect(hasComponents).toBe(false);
    expect(ctx.mockLineupsService.nominate).not.toHaveBeenCalled();
  });
}

/**
 * AC-4: building lineup + unnominated game (no auto-nominate pref) — DM
 * shows a 4-button nomination prompt with the Community Lineup copy.
 */
function nominationPromptTests() {
  async function sendPromptMessage() {
    stubGameLookup(ctx, { id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });
    stubGameNominated(ctx, false);
    stubAutoNominatePref(ctx, false);

    const msg = createMessage(
      ctx,
      'https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(ctx.listener, msg);
  }

  it('DM copy asks to add the game to the current Community Lineup', async () => {
    await sendPromptMessage();

    expect(ctx.mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          '**Counter-Strike 2** — add to the current Community Lineup?',
        ),
      }),
    );
  });

  it('DM includes an action row with exactly 4 buttons', async () => {
    await sendPromptMessage();

    const call = ctx.mockDmSend.mock.calls[0]?.[0] as {
      components?: unknown[];
    };
    expect(Array.isArray(call?.components)).toBe(true);
    const firstRow = call?.components?.[0] as {
      components?: unknown[];
      toJSON?: () => { components: unknown[] };
    };
    const buttons =
      firstRow?.components ?? firstRow?.toJSON?.().components ?? [];
    expect(buttons.length).toBe(4);
  });

  it('uses steam_nominate_* custom IDs for all four buttons', async () => {
    await sendPromptMessage();

    const call = ctx.mockDmSend.mock.calls[0]?.[0] as {
      components?: unknown[];
    };
    const firstRow = call?.components?.[0] as {
      components?: Array<Record<string, unknown>>;
      toJSON?: () => { components: Array<Record<string, unknown>> };
    };
    const rawButtons =
      firstRow?.components ?? firstRow?.toJSON?.().components ?? [];
    const customIds = rawButtons.map((b) => {
      const direct = (b?.data as { custom_id?: string } | undefined)?.custom_id;
      const viaJson = (
        b?.toJSON as (() => { custom_id?: string }) | undefined
      )?.();
      return direct ?? viaJson?.custom_id ?? '';
    });
    const joined = customIds.join(' ');
    expect(joined).toContain('steam_nominate_nominate');
    expect(joined).toContain('steam_nominate_heart');
    expect(joined).toContain('steam_nominate_auto');
    expect(joined).toContain('steam_nominate_dismiss');
  });
}

/**
 * AC-5: building lineup + autoNominateSteamUrls=true — directly nominates
 * without a prompt and DMs a confirmation.
 */
function autoNominateTests() {
  it('auto-nominates without prompt when preference is enabled', async () => {
    stubGameLookup(ctx, { id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });
    stubGameNominated(ctx, false);
    stubAutoNominatePref(ctx, true);

    const msg = createMessage(
      ctx,
      'https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(ctx.listener, msg);

    expect(ctx.mockLineupsService.nominate).toHaveBeenCalled();
    expect(ctx.mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'Auto-nominated **Counter-Strike 2** to the current lineup!',
        ),
      }),
    );
    // No buttons on the auto-nominate confirmation DM.
    const call = ctx.mockDmSend.mock.calls[0]?.[0] as {
      components?: unknown[];
    };
    const hasComponents =
      Array.isArray(call?.components) && (call?.components?.length ?? 0) > 0;
    expect(hasComponents).toBe(false);
  });
}

/**
 * AC-6: auto-nominate enabled but nomination cap hit — DM surfaces the
 * exact error message from the LineupsService rejection.
 */
function nominationCapTests() {
  it('surfaces the cap error message from LineupsService in the DM', async () => {
    stubGameLookup(ctx, { id: 42, name: 'Counter-Strike 2', steamAppId: 730 });
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });
    stubGameNominated(ctx, false);
    stubAutoNominatePref(ctx, true);
    ctx.mockLineupsService.nominate.mockRejectedValueOnce(
      new Error('Lineup has reached the 25-entry cap'),
    );

    const msg = createMessage(
      ctx,
      'https://store.steampowered.com/app/730/CS2/',
    );
    await callHandleMessage(ctx.listener, msg);

    expect(ctx.mockDmSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Lineup has reached the 25-entry cap'),
      }),
    );
  });
}

/** Button handler tests — all four steam_nominate_* button IDs. */
function buttonHandlerTests() {
  it('Nominate button calls LineupsService.nominate and updates in place', async () => {
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });

    const interaction = makeButtonInteraction('steam_nominate_nominate:42');
    await callHandleButtonInteraction(ctx.listener, interaction);

    expect(ctx.mockLineupsService.nominate).toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Nominated **'),
        components: [],
      }),
    );
  });

  it('Just Heart It button calls addDiscordInterest and updates in place', async () => {
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    ctx.mockDb.onConflictDoNothing.mockResolvedValueOnce(undefined);

    const interaction = makeButtonInteraction('steam_nominate_heart:42');
    await callHandleButtonInteraction(ctx.listener, interaction);

    expect(ctx.mockDb.insert).toHaveBeenCalled();
    expect(ctx.mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'discord' }),
    );
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Marked as interested!',
        components: [],
      }),
    );
    expect(ctx.mockLineupsService.nominate).not.toHaveBeenCalled();
  });

  it('Always Auto-Nominate button sets pref + nominates and updates in place', async () => {
    stubUserLookup(ctx, { id: 7, discordId: 'discord-user-1' });
    stubBuildingLineup(ctx, { id: 123 });
    ctx.mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

    const interaction = makeButtonInteraction('steam_nominate_auto:42');
    await callHandleButtonInteraction(ctx.listener, interaction);

    const valuesCalls = ctx.mockDb.values.mock.calls;
    const hasAutoNominatePref = valuesCalls.some(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?.key === 'autoNominateSteamUrls',
    );
    expect(hasAutoNominatePref).toBe(true);
    expect(ctx.mockLineupsService.nominate).toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Auto-nominate enabled for future Steam URLs!',
        components: [],
      }),
    );
  });

  it('Dismiss button updates in place to "Dismissed." without side effects', async () => {
    const interaction = makeButtonInteraction('steam_nominate_dismiss:42');
    await callHandleButtonInteraction(ctx.listener, interaction);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Dismissed.',
        components: [],
      }),
    );
    expect(ctx.mockLineupsService.nominate).not.toHaveBeenCalled();
    expect(ctx.mockDb.insert).not.toHaveBeenCalled();
  });
}

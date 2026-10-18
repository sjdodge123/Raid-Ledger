/**
 * ROK-1841 — unit tests for the intent-token fixture helpers.
 *
 * The parity case drives the bot's real "Join & Sign Up" producer
 * (`showOnboardingEphemeral` → private `buildOnboardingRow`) and asserts the
 * fixture's `buildJoinUrl` yields the byte-identical URL, so the two cannot
 * drift apart silently.
 */
import { BadRequestException } from '@nestjs/common';
import { ActionRowBuilder } from 'discord.js';
import { z } from 'zod';
import { showOnboardingEphemeral } from '../discord-bot/listeners/signup-status.handlers';
import {
  createMockButtonInteraction,
  createMockDeps,
} from '../discord-bot/listeners/signup-handlers.spec-helpers';
import { at } from '../common/testing/narrow';
import {
  buildJoinUrl,
  parseIntentTokenBody,
} from './demo-test-intent-token.helpers';

const CLIENT_URL = 'https://smoke.example.test';
const TOKEN = 'eyJ.header+/=.sig';
const ORIGINAL_CLIENT_URL = process.env.CLIENT_URL;

const ReplySchema = z.object({
  components: z.array(z.instanceof(ActionRowBuilder)),
});

/** Run the bot's onboarding ephemeral and return the Join button's URL. */
async function botJoinUrl(eventId: number): Promise<string | undefined> {
  const deps = Object.assign(createMockDeps(), {
    intentTokenService: { generate: jest.fn().mockReturnValue(TOKEN) },
  });
  (deps.db.select as jest.Mock).mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([{ id: eventId, title: 'Raid' }]),
      }),
    }),
  });
  const interaction = Object.assign(createMockButtonInteraction(), {
    user: { id: '123456789012345678' },
  });
  await showOnboardingEphemeral(interaction, eventId, deps);
  const reply = ReplySchema.parse(
    jest.mocked(interaction.editReply).mock.calls[0]?.[0],
  );
  const button = at(at(reply.components, 0).toJSON().components, 0);
  return 'url' in button ? button.url : undefined;
}

describe('buildJoinUrl', () => {
  afterAll(() => {
    if (ORIGINAL_CLIENT_URL === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = ORIGINAL_CLIENT_URL;
  });

  it("matches the bot's buildOnboardingRow join URL exactly", async () => {
    process.env.CLIENT_URL = CLIENT_URL;
    const expected = buildJoinUrl(CLIENT_URL, 42, 'signup', TOKEN);
    expect(await botJoinUrl(42)).toBe(expected);
  });
});

describe('parseIntentTokenBody', () => {
  it('accepts a valid body and defaults userId to null', () => {
    expect(parseIntentTokenBody({ eventId: 3, intent: 'signup' })).toEqual({
      eventId: 3,
      intent: 'signup',
      userId: null,
    });
  });

  it.each([undefined, null, { eventId: 3 }, { eventId: 0, intent: 'signup' }])(
    'rejects %p with a 400',
    (body) => {
      expect(() => parseIntentTokenBody(body)).toThrow(BadRequestException);
    },
  );
});

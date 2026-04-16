/**
 * AI Chat Plugin smoke tests (ROK-566).
 *
 * Tests the conversational tree interface via Discord DMs.
 *
 * Bot-to-bot DMs are blocked by Discord (error 50007), so these tests
 * use the POST /admin/test/ai-chat-simulate endpoint to trigger the
 * AI chat handler directly, bypassing the DM channel. The endpoint
 * accepts a simulated message (text or button custom ID) and returns
 * the bot's response (content, embeds, components) as JSON.
 *
 * All tests will FAIL until the AI chat listener, service, and the
 * simulate endpoint are implemented by the dev agent.
 */
import {
  createEvent,
  deleteEvent,
  futureTime,
  awaitProcessing,
} from '../fixtures.js';
import { pollForCondition } from '../../helpers/polling.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Timeout for simulated responses — kept short for fast TDD failure. */
const SIM_TIMEOUT = 8_000;

/** Prefix used by all AI chat button custom IDs. */
const AI_PREFIX = 'ai:';

/**
 * Shape of the simulated AI chat response from the test endpoint.
 * The dev agent must implement POST /admin/test/ai-chat-simulate
 * returning this shape.
 */
interface AiChatSimResponse {
  /** Plain text content of the bot's reply. */
  content: string;
  /** Embeds in the reply (simplified). */
  embeds: { title: string | null; description: string | null }[];
  /** Button/component metadata. */
  components: { customId: string | null; label: string | null }[];
}

/**
 * Simulate an AI chat DM interaction via the test API.
 * Sends a text message or button click from a Discord user.
 */
async function simulate(
  ctx: TestContext,
  opts: {
    /** The Discord user ID sending the DM. */
    discordUserId: string;
    /** Free-text message content (mutually exclusive with buttonId). */
    text?: string;
    /** Button custom ID being clicked (mutually exclusive with text). */
    buttonId?: string;
  },
): Promise<AiChatSimResponse> {
  return ctx.api.post<AiChatSimResponse>(
    '/admin/test/ai-chat-simulate',
    {
      discordUserId: opts.discordUserId,
      text: opts.text,
      buttonId: opts.buttonId,
    },
  );
}

/**
 * Count buttons with the AI prefix in the response components.
 */
function countAiButtons(
  components: { customId: string | null }[],
): number {
  return components.filter(
    (c) => c.customId?.startsWith(AI_PREFIX),
  ).length;
}

/**
 * Check if a response has a specific AI button by custom ID suffix.
 * E.g., hasAiButton(components, 'events') checks for 'ai:events'.
 */
function hasAiButton(
  components: { customId: string | null }[],
  idSuffix: string,
): boolean {
  return components.some(
    (c) => c.customId === `${AI_PREFIX}${idSuffix}`,
  );
}

/** Concatenate all text content from a response for assertion. */
function allText(res: AiChatSimResponse): string {
  return [
    res.content,
    ...res.embeds.map((e) => [e.title, e.description].join(' ')),
  ]
    .join(' ')
    .toLowerCase();
}

// ── AC1: Welcome menu with correct button count ──

const welcomeMenuMember: SmokeTest = {
  name: 'AI Chat: DM with no session shows welcome menu (member = 5 buttons)',
  category: 'dm',
  async run(ctx) {
    // Simulate a DM from the test bot's linked Discord user
    const res = await simulate(ctx, {
      discordUserId: ctx.testBotDiscordId,
      text: 'hello',
    });
    const aiButtonCount = countAiButtons(res.components);
    // Welcome menu should have 5 buttons for regular members:
    // Events, My Signups, Game Library, Lineup, Polls
    if (aiButtonCount < 5) {
      throw new Error(
        `Expected at least 5 AI buttons for member welcome menu, got ${aiButtonCount}. ` +
        `Components: ${JSON.stringify(res.components.map((c) => c.customId))}`,
      );
    }
  },
};

// ── AC2: Clicking [Events] shows sub-menu ──

const eventsSubMenu: SmokeTest = {
  name: 'AI Chat: [Events] button shows This Week / Next Week / Search by Game',
  category: 'dm',
  async run(ctx) {
    // Click the Events button
    const res = await simulate(ctx, {
      discordUserId: ctx.testBotDiscordId,
      buttonId: 'ai:events',
    });
    if (!hasAiButton(res.components, 'events:this-week')) {
      throw new Error(
        'Events sub-menu missing "This Week" button (ai:events:this-week). ' +
        `Got: ${JSON.stringify(res.components.map((c) => c.customId))}`,
      );
    }
    if (!hasAiButton(res.components, 'events:next-week')) {
      throw new Error(
        'Events sub-menu missing "Next Week" button (ai:events:next-week). ' +
        `Got: ${JSON.stringify(res.components.map((c) => c.customId))}`,
      );
    }
  },
};

// ── AC3: [This Week] with events -> LLM summary ──

const thisWeekWithEvents: SmokeTest = {
  name: 'AI Chat: [This Week] with events returns LLM summary + continuation buttons',
  category: 'dm',
  async run(ctx) {
    // Create an event this week so there's data to summarize
    const ev = await createEvent(ctx.api, 'ai-chat-thisweek', {
      startTime: futureTime(60),
      endTime: futureTime(120),
    });
    try {
      await awaitProcessing(ctx.api);
      // Click "This Week" button
      const res = await simulate(ctx, {
        discordUserId: ctx.testBotDiscordId,
        buttonId: 'ai:events:this-week',
      });
      // Should have meaningful content (LLM summary, > 20 chars)
      const textContent = allText(res);
      const hasContent = textContent.length > 20;
      if (!hasContent) {
        throw new Error(
          `Expected LLM summary with > 20 chars, got: "${textContent}"`,
        );
      }
      // Should NOT be the "no events" static message
      if (textContent.includes('no events scheduled this week')) {
        throw new Error(
          'Got static "no events" message despite creating a test event',
        );
      }
      // Should have continuation buttons (Back, Home at minimum)
      const hasNav =
        hasAiButton(res.components, 'back') ||
        hasAiButton(res.components, 'home');
      if (!hasNav) {
        throw new Error(
          'LLM summary response missing Back/Home navigation buttons. ' +
          `Got: ${JSON.stringify(res.components.map((c) => c.customId))}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ── AC4: [This Week] with no events -> static message ──

const thisWeekNoEvents: SmokeTest = {
  name: 'AI Chat: [This Week] with no events returns static "No events scheduled" message',
  category: 'dm',
  async run(ctx) {
    // Click "This Week" — assuming no events are scheduled this week
    const res = await simulate(ctx, {
      discordUserId: ctx.testBotDiscordId,
      buttonId: 'ai:events:this-week',
    });
    const textContent = allText(res);
    if (!textContent.includes('no events scheduled this week')) {
      throw new Error(
        `Expected "No events scheduled this week." message. Got: "${textContent.slice(0, 200)}"`,
      );
    }
  },
};

// ── AC5: [My Signups] as unlinked user -> link prompt ──

const mySignupsUnlinked: SmokeTest = {
  name: 'AI Chat: [My Signups] as unlinked user shows "Link your Discord account" prompt',
  category: 'dm',
  async run(ctx) {
    // Use a fake Discord user ID that is NOT linked to any RL account
    const unlinkedDiscordId = '000000000000000001';
    const res = await simulate(ctx, {
      discordUserId: unlinkedDiscordId,
      buttonId: 'ai:my-signups',
    });
    const textContent = allText(res);
    if (!textContent.includes('link your discord')) {
      throw new Error(
        'Expected "Link your Discord account" prompt for unlinked user. ' +
        `Got: "${textContent.slice(0, 200)}"`,
      );
    }
  },
};

// ── AC6: [Stats] not visible to non-operator users ──

const statsHiddenFromMembers: SmokeTest = {
  name: 'AI Chat: [Stats] button not visible to non-operator users',
  category: 'dm',
  async run(ctx) {
    // Simulate a DM from a non-operator user (the linked demo user)
    const res = await simulate(ctx, {
      discordUserId: ctx.testBotDiscordId,
      text: 'hello',
    });
    // Check that there is NO stats button for non-operator users
    if (hasAiButton(res.components, 'stats')) {
      throw new Error(
        'Stats button should NOT be visible to non-operator users, ' +
        'but ai:stats was present in the welcome menu',
      );
    }
  },
};

// ── AC7: Free-text "events" routes to Events tree path ──

const freeTextEventsRoute: SmokeTest = {
  name: 'AI Chat: Free-text "events" routes to Events tree path',
  category: 'dm',
  async run(ctx) {
    // Send free-text "events" — should route to Events sub-menu
    const res = await simulate(ctx, {
      discordUserId: ctx.testBotDiscordId,
      text: 'events',
    });
    const hasEventsButtons = res.components.some(
      (c) => c.customId?.startsWith('ai:events'),
    );
    if (!hasEventsButtons) {
      throw new Error(
        'Free-text "events" did not route to Events tree path. ' +
        `Got components: ${JSON.stringify(res.components.map((c) => c.customId))}`,
      );
    }
  },
};

// ── AC8: Session timeout after 5 min inactivity ──

const sessionTimeout: SmokeTest = {
  name: 'AI Chat: Session times out after 5 min inactivity -> welcome menu',
  category: 'dm',
  async run(ctx) {
    const discordUserId = ctx.testBotDiscordId;

    // Step 1: Navigate to a sub-menu to establish session state
    await simulate(ctx, { discordUserId, buttonId: 'ai:events' });

    // Step 2: Expire the session via test endpoint
    await ctx.api.post('/admin/test/expire-ai-chat-session', {
      discordUserId,
    });

    // Step 3: Send a new message — should get fresh welcome menu
    const res = await simulate(ctx, { discordUserId, text: 'hello' });
    const aiButtonCount = countAiButtons(res.components);
    if (aiButtonCount < 5) {
      throw new Error(
        `Expected welcome menu (5+ buttons) after session expiry, got ${aiButtonCount}. ` +
        `This means the session was not properly expired.`,
      );
    }
  },
};

// ── AC9: Feature gated behind ai_chat_enabled setting ──

const featureGateDisabled: SmokeTest = {
  name: 'AI Chat: Feature gated behind ai_chat_enabled setting',
  category: 'dm',
  async run(ctx) {
    // Disable AI chat via the DEMO_MODE test endpoint
    await ctx.api.post('/admin/test/set-ai-chat-enabled', {
      enabled: false,
    });
    try {
      // Simulate a DM — should get "disabled" response with no buttons
      const res = await simulate(ctx, {
        discordUserId: ctx.testBotDiscordId,
        text: 'hello',
      });
      const textContent = allText(res);
      if (
        !textContent.includes('disabled') &&
        !textContent.includes('not available')
      ) {
        throw new Error(
          'Expected "AI chat is currently disabled" when feature is off. ' +
          `Got: "${textContent.slice(0, 200)}"`,
        );
      }
      const aiButtonCount = countAiButtons(res.components);
      if (aiButtonCount > 0) {
        throw new Error(
          `Expected 0 AI buttons when feature disabled, got ${aiButtonCount}`,
        );
      }
    } finally {
      // Re-enable the feature for other tests
      await ctx.api
        .post('/admin/test/set-ai-chat-enabled', { enabled: true })
        .catch(() => {});
    }
  },
};

// ── AC10: Back button returns to parent, Home returns to welcome ──

const backAndHomeNavigation: SmokeTest = {
  name: 'AI Chat: Back returns to parent menu, Home returns to welcome',
  category: 'dm',
  async run(ctx) {
    const discordUserId = ctx.testBotDiscordId;

    // Step 1: Navigate into Events sub-menu
    const eventsMenu = await simulate(ctx, {
      discordUserId,
      buttonId: 'ai:events',
    });

    // Verify Back and Home buttons are present
    if (!hasAiButton(eventsMenu.components, 'back')) {
      throw new Error(
        'Events sub-menu missing Back button (ai:back). ' +
        `Got: ${JSON.stringify(eventsMenu.components.map((c) => c.customId))}`,
      );
    }
    if (!hasAiButton(eventsMenu.components, 'home')) {
      throw new Error(
        'Events sub-menu missing Home button (ai:home). ' +
        `Got: ${JSON.stringify(eventsMenu.components.map((c) => c.customId))}`,
      );
    }

    // Step 2: Click Home -> should return to welcome menu
    const homeRes = await simulate(ctx, {
      discordUserId,
      buttonId: 'ai:home',
    });
    const homeButtonCount = countAiButtons(homeRes.components);
    if (homeButtonCount < 5) {
      throw new Error(
        `Home button did not return to welcome menu. ` +
        `Expected 5+ buttons, got ${homeButtonCount}. ` +
        `Components: ${JSON.stringify(homeRes.components.map((c) => c.customId))}`,
      );
    }

    // Step 3: Navigate to Events again, then click Back
    await simulate(ctx, { discordUserId, buttonId: 'ai:events' });
    const backRes = await simulate(ctx, {
      discordUserId,
      buttonId: 'ai:back',
    });
    // Back from Events should return to welcome (parent = root)
    const backButtonCount = countAiButtons(backRes.components);
    if (backButtonCount < 5) {
      throw new Error(
        `Back button did not return to parent menu. ` +
        `Expected 5+ buttons, got ${backButtonCount}`,
      );
    }
  },
};

export const aiChatTests: SmokeTest[] = [
  welcomeMenuMember,
  eventsSubMenu,
  thisWeekWithEvents,
  thisWeekNoEvents,
  mySignupsUnlinked,
  statsHiddenFromMembers,
  freeTextEventsRoute,
  sessionTimeout,
  featureGateDisabled,
  backAndHomeNavigation,
];

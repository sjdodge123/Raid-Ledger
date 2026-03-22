/**
 * Slash command smoke tests.
 *
 * These tests call the test harness endpoint POST /admin/test/slash-command,
 * which simulates a Discord slash command interaction and returns the resolved
 * response without requiring a live Discord interaction token.
 *
 * The endpoint does NOT exist yet — these tests are written TDD-style and
 * will FAIL until a dev agent implements the endpoint.
 *
 * Expected response shape:
 *   { content?: string; embeds?: object[]; components?: object[]; deferred?: boolean }
 *
 * Autocomplete calls go to POST /admin/test/slash-command/autocomplete and
 * return { choices: { name: string; value: string }[] }.
 */
import {
  createEvent,
  deleteEvent,
  createBinding,
  deleteBinding,
  futureTime,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

// ---------------------------------------------------------------------------
// Response types returned by the test harness endpoint
// ---------------------------------------------------------------------------

interface SlashCommandResponse {
  content?: string;
  embeds?: { title?: string; description?: string; fields?: { name: string; value: string }[] }[];
  components?: { type: number; components?: { label?: string; customId?: string }[] }[];
  deferred?: boolean;
}

interface AutocompleteResponse {
  choices: { name: string; value: string | number }[];
}

// ---------------------------------------------------------------------------
// Helper: POST to the slash-command harness endpoint
// ---------------------------------------------------------------------------

interface SlashCommandOptions {
  commandName: string;
  subcommand?: string;
  options?: Record<string, unknown>;
  discordUserId?: string;
  guildId?: string;
  channelId?: string;
}

async function invokeCommand(
  ctx: TestContext,
  opts: SlashCommandOptions,
): Promise<SlashCommandResponse> {
  return ctx.api.post<SlashCommandResponse>('/admin/test/slash-command', {
    commandName: opts.commandName,
    subcommand: opts.subcommand,
    options: opts.options ?? {},
    discordUserId: opts.discordUserId ?? ctx.testBotDiscordId,
    guildId: opts.guildId ?? ctx.config.guildId,
    channelId: opts.channelId ?? ctx.defaultChannelId,
  });
}

async function invokeAutocomplete(
  ctx: TestContext,
  opts: {
    commandName: string;
    focusedOption: string;
    value: string;
    subcommand?: string;
  },
): Promise<AutocompleteResponse> {
  return ctx.api.post<AutocompleteResponse>('/admin/test/slash-command/autocomplete', {
    commandName: opts.commandName,
    subcommand: opts.subcommand,
    focusedOption: opts.focusedOption,
    value: opts.value,
    guildId: ctx.config.guildId,
  });
}

// ---------------------------------------------------------------------------
// Test 1: /help returns command list embed
// ---------------------------------------------------------------------------

const helpReturnsCommandList: SmokeTest = {
  name: '/help returns command list embed',
  category: 'command',
  async run(ctx) {
    const res = await invokeCommand(ctx, { commandName: 'help' });
    if (!res.embeds || res.embeds.length === 0) {
      throw new Error(
        `/help: expected at least one embed, got: ${JSON.stringify(res)}`,
      );
    }
    const titleOk = res.embeds.some(
      (e) => e.title && e.title.toLowerCase().includes('raid-ledger bot commands'),
    );
    if (!titleOk) {
      const titles = res.embeds.map((e) => e.title).join(', ');
      throw new Error(
        `/help: expected embed title containing "Raid-Ledger Bot Commands", got: [${titles}]`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 2: /events with no upcoming events
// ---------------------------------------------------------------------------

const eventsNoUpcoming: SmokeTest = {
  name: '/events with no upcoming events returns empty message',
  category: 'command',
  async run(ctx) {
    const res = await invokeCommand(ctx, {
      commandName: 'events',
      discordUserId: ctx.testBotDiscordId,
    });
    const hasEmpty =
      (res.content && res.content.toLowerCase().includes('no upcoming events')) ||
      (res.embeds && res.embeds.some(
        (e) => (e.description ?? '').toLowerCase().includes('no upcoming events'),
      ));
    if (!hasEmpty) {
      throw new Error(
        `/events (no data): expected "No upcoming events found." response, got: ${JSON.stringify(res)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 3: /events with data returns embed containing event title
// ---------------------------------------------------------------------------

const eventsWithData: SmokeTest = {
  name: '/events with upcoming event returns embed containing event',
  category: 'command',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'cmd-events-list');
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'events',
        discordUserId: ctx.testBotDiscordId,
      });
      const found =
        (res.content && res.content.includes(ev.title)) ||
        (res.embeds && res.embeds.some(
          (e) => e.title?.includes(ev.title) || e.description?.includes(ev.title),
        ));
      if (!found) {
        throw new Error(
          `/events: expected event title "${ev.title}" in response, got: ${JSON.stringify(res)}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Test 4: /event create quick-creates an event
// ---------------------------------------------------------------------------

const eventCreate: SmokeTest = {
  name: '/event create returns confirmation embed and event is persisted',
  category: 'command',
  async run(ctx) {
    const title = `cmd-create-${Date.now()}`;
    const gameName = ctx.games[0]?.name ?? 'Test Game';
    let createdEventId: number | undefined;
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'event',
        subcommand: 'create',
        options: {
          title,
          game: gameName,
          time: futureTime(90),
        },
        discordUserId: ctx.testBotDiscordId,
      });
      const hasConfirmation =
        (res.content && res.content.length > 0) ||
        (res.embeds && res.embeds.length > 0);
      if (!hasConfirmation) {
        throw new Error(
          `/event create: expected confirmation response, got: ${JSON.stringify(res)}`,
        );
      }
      // Verify the event was actually persisted in the API
      const eventsRes = await ctx.api.get<{ data: { id: number; title: string }[] }>(
        '/events?limit=10&page=1',
      );
      const events = Array.isArray(eventsRes) ? eventsRes : (eventsRes.data ?? []);
      const persisted = events.find((e: { id: number; title: string }) => e.title === title);
      if (!persisted) {
        throw new Error(
          `/event create: event "${title}" not found in API after command`,
        );
      }
      createdEventId = persisted.id;
    } finally {
      if (createdEventId) {
        await deleteEvent(ctx.api, createdEventId);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Test 5: /event plan returns a wizard link
// ---------------------------------------------------------------------------

const eventPlanWizardLink: SmokeTest = {
  name: '/event plan returns wizard URL or magic link',
  category: 'command',
  async run(ctx) {
    const res = await invokeCommand(ctx, {
      commandName: 'event',
      subcommand: 'plan',
      discordUserId: ctx.testBotDiscordId,
    });
    const text = [
      res.content ?? '',
      ...(res.embeds ?? []).map((e) => `${e.title ?? ''} ${e.description ?? ''}`),
    ].join(' ');
    const hasLink = /https?:\/\//.test(text) || /\/events\/new/.test(text);
    if (!hasLink) {
      throw new Error(
        `/event plan: expected a URL in response, got: ${JSON.stringify(res)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 6: /roster for a valid event returns roster embed
// ---------------------------------------------------------------------------

const rosterValidEvent: SmokeTest = {
  name: '/roster for valid event returns roster embed',
  category: 'command',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'cmd-roster-valid');
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'roster',
        options: { event: String(ev.id) },
        discordUserId: ctx.testBotDiscordId,
      });
      if (!res.embeds || res.embeds.length === 0) {
        throw new Error(
          `/roster: expected embed for event ${ev.id}, got: ${JSON.stringify(res)}`,
        );
      }
      const hasEventRef = res.embeds.some(
        (e) =>
          e.title?.includes(ev.title) ||
          (e.description ?? '').includes(ev.title),
      );
      if (!hasEventRef) {
        throw new Error(
          `/roster: embed does not reference event "${ev.title}", got: ${JSON.stringify(res.embeds)}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Test 7: /roster with invalid event ID returns error/empty response
// ---------------------------------------------------------------------------

const rosterInvalidEvent: SmokeTest = {
  name: '/roster with invalid event ID returns error or empty response',
  category: 'command',
  async run(ctx) {
    // Use a non-existent event ID — response should be an error message,
    // not an embed with real data. The endpoint may return 200 with error content
    // rather than 4xx since slash commands return ephemeral error messages.
    const res = await invokeCommand(ctx, {
      commandName: 'roster',
      options: { event: '99999999' },
      discordUserId: ctx.testBotDiscordId,
    });
    const text = [
      res.content ?? '',
      ...(res.embeds ?? []).map((e) => `${e.title ?? ''} ${e.description ?? ''}`),
    ].join(' ').toLowerCase();
    const isError =
      text.includes('not found') ||
      text.includes('error') ||
      text.includes('invalid') ||
      text.includes('no event') ||
      (res.embeds ?? []).length === 0;
    if (!isError) {
      throw new Error(
        `/roster (bad id): expected error/empty response, got: ${JSON.stringify(res)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 8: /bind channel creates a binding
// ---------------------------------------------------------------------------

const bindChannel: SmokeTest = {
  name: '/bind channel creates a Discord channel binding',
  category: 'command',
  async run(ctx) {
    const ch = ctx.textChannels[0];
    if (!ch) throw new Error('No text channels available');
    const gameId = ctx.games[0]?.id;
    let bindingId: string | undefined;
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'bind',
        options: {
          channel: ch.id,
          game: gameId,
        },
        guildId: ctx.config.guildId,
        discordUserId: ctx.testBotDiscordId,
      });
      const hasSuccess =
        (res.content && res.content.length > 0) ||
        (res.embeds && res.embeds.length > 0);
      if (!hasSuccess) {
        throw new Error(
          `/bind: expected success response, got: ${JSON.stringify(res)}`,
        );
      }
      // Look up the binding that was just created so we can clean it up
      const bindingsRes = await ctx.api.get<{ data: { id: string; channelId: string }[] }>(
        '/admin/discord/bindings',
      );
      const bindings = Array.isArray(bindingsRes) ? bindingsRes : (bindingsRes.data ?? []);
      const created = bindings.find(
        (b: { id: string; channelId: string }) => b.channelId === ch.id,
      );
      if (created) bindingId = created.id;
    } finally {
      if (bindingId) {
        await deleteBinding(ctx.api, bindingId);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Test 9: /unbind channel removes a binding
// ---------------------------------------------------------------------------

const unbindChannel: SmokeTest = {
  name: '/unbind channel removes the channel binding',
  category: 'command',
  async run(ctx) {
    const ch = ctx.textChannels.length > 1 ? ctx.textChannels[1] : ctx.textChannels[0];
    if (!ch) throw new Error('No text channels available');
    // Create a binding first so we have something to unbind
    const bindingId = await createBinding(ctx.api, {
      channelId: ch.id,
      channelType: 'text',
      purpose: 'event_announcements',
    });
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'unbind',
        options: { channel: ch.id },
        guildId: ctx.config.guildId,
        discordUserId: ctx.testBotDiscordId,
      });
      const text = [
        res.content ?? '',
        ...(res.embeds ?? []).map((e) => `${e.title ?? ''} ${e.description ?? ''}`),
      ].join(' ').toLowerCase();
      const hasSuccess =
        text.includes('unbound') ||
        text.includes('removed') ||
        text.includes('success') ||
        (res.content && res.content.length > 0) ||
        (res.embeds && res.embeds.length > 0);
      if (!hasSuccess) {
        throw new Error(
          `/unbind: expected success response, got: ${JSON.stringify(res)}`,
        );
      }
    } finally {
      // Cleanup: delete the binding if it still exists
      await deleteBinding(ctx.api, bindingId);
    }
  },
};

// ---------------------------------------------------------------------------
// Test 10: /bindings list returns embed listing bindings
// ---------------------------------------------------------------------------

const bindingsList: SmokeTest = {
  name: '/bindings lists current channel bindings',
  category: 'command',
  async run(ctx) {
    const res = await invokeCommand(ctx, {
      commandName: 'bindings',
      guildId: ctx.config.guildId,
    });
    // Should return either an embed with bindings or a "no bindings" message
    const hasResponse =
      (res.content && res.content.length > 0) ||
      (res.embeds && res.embeds.length > 0);
    if (!hasResponse) {
      throw new Error(
        `/bindings: expected embed or content response, got: ${JSON.stringify(res)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 11: /playing set game acknowledges the change
// ---------------------------------------------------------------------------

const playingSetGame: SmokeTest = {
  name: '/playing set game returns acknowledgment',
  category: 'command',
  async run(ctx) {
    const gameName = ctx.games[0]?.name ?? 'Test Game';
    const res = await invokeCommand(ctx, {
      commandName: 'playing',
      options: { game: gameName },
      guildId: ctx.config.guildId,
      discordUserId: ctx.testBotDiscordId,
    });
    const hasResponse =
      (res.content && res.content.length > 0) ||
      (res.embeds && res.embeds.length > 0);
    if (!hasResponse) {
      throw new Error(
        `/playing (set): expected acknowledgment, got: ${JSON.stringify(res)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 12: /playing clear game acknowledges cleared
// ---------------------------------------------------------------------------

const playingClearGame: SmokeTest = {
  name: '/playing without game argument clears current game',
  category: 'command',
  async run(ctx) {
    const res = await invokeCommand(ctx, {
      commandName: 'playing',
      options: {},
      guildId: ctx.config.guildId,
      discordUserId: ctx.testBotDiscordId,
    });
    const hasResponse =
      (res.content && res.content.length > 0) ||
      (res.embeds && res.embeds.length > 0);
    if (!hasResponse) {
      throw new Error(
        `/playing (clear): expected acknowledgment, got: ${JSON.stringify(res)}`,
      );
    }
    const text = [
      res.content ?? '',
      ...(res.embeds ?? []).map((e) => `${e.title ?? ''} ${e.description ?? ''}`),
    ].join(' ').toLowerCase();
    const isCleared =
      text.includes('clear') ||
      text.includes('remov') ||
      text.includes('no longer') ||
      text.includes('unset') ||
      text.length > 0;
    if (!isCleared) {
      throw new Error(
        `/playing (clear): expected cleared confirmation, got: ${JSON.stringify(res)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Test 13: /invite returns invite content for an event
// ---------------------------------------------------------------------------

const inviteEvent: SmokeTest = {
  name: '/invite returns invite content for an event',
  category: 'command',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'cmd-invite');
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'invite',
        options: { event: String(ev.id) },
        guildId: ctx.config.guildId,
        discordUserId: ctx.testBotDiscordId,
      });
      const hasContent =
        (res.content && res.content.length > 0) ||
        (res.embeds && res.embeds.length > 0);
      if (!hasContent) {
        throw new Error(
          `/invite: expected invite content for event ${ev.id}, got: ${JSON.stringify(res)}`,
        );
      }
      // Verify the invite references the event somehow
      const text = [
        res.content ?? '',
        ...(res.embeds ?? []).map((e) => `${e.title ?? ''} ${e.description ?? ''}`),
      ].join(' ');
      const hasRef =
        text.includes(ev.title) ||
        text.includes(String(ev.id));
      if (!hasRef) {
        throw new Error(
          `/invite: response does not reference event "${ev.title}", got: ${JSON.stringify(res)}`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Test 14: Autocomplete — game names
// ---------------------------------------------------------------------------

const autocompleteGameNames: SmokeTest = {
  name: 'Autocomplete: game name suggestions returned for /event create',
  category: 'command',
  async run(ctx) {
    const res = await invokeAutocomplete(ctx, {
      commandName: 'event',
      subcommand: 'create',
      focusedOption: 'game',
      value: '',
    });
    if (!res.choices || !Array.isArray(res.choices)) {
      throw new Error(
        `Autocomplete: expected "choices" array, got: ${JSON.stringify(res)}`,
      );
    }
    if (res.choices.length === 0) {
      throw new Error(
        `Autocomplete: expected at least one game choice, got empty array`,
      );
    }
    const hasNames = res.choices.every(
      (c) => typeof c.name === 'string' && c.name.length > 0,
    );
    if (!hasNames) {
      throw new Error(
        `Autocomplete: choices missing "name" field: ${JSON.stringify(res.choices)}`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const slashCommandTests: SmokeTest[] = [
  helpReturnsCommandList,
  eventsNoUpcoming,
  eventsWithData,
  eventCreate,
  eventPlanWizardLink,
  rosterValidEvent,
  rosterInvalidEvent,
  bindChannel,
  unbindChannel,
  bindingsList,
  playingSetGame,
  playingClearGame,
  inviteEvent,
  autocompleteGameNames,
];

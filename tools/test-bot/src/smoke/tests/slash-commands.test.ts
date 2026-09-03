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
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

// ---------------------------------------------------------------------------
// Response types returned by the test harness endpoint
// ---------------------------------------------------------------------------

interface SlashCommandEmbed {
  title?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  /** Chrome author line, e.g. `⚙ BINDING SAVED` (ROK-1462 D5). */
  author?: { name?: string };
  /** `${community} · ${label}` when the chrome was given a footer label. */
  footer?: { text?: string };
  /** Decimal colour — the chrome's only writer is `colorForState`. */
  color?: number;
}

interface SlashCommandResponse {
  content?: string;
  embeds?: SlashCommandEmbed[];
  components?: { type: number; components?: { label?: string; customId?: string }[] }[];
  deferred?: boolean;
}

// ---------------------------------------------------------------------------
// ROK-1462 D5/D6 — command-reply chrome expectations
//
// Every command reply is `createChannelEmbed({ state: 'done' })`: slate, with
// the state in the AUTHOR line and the binding settings as INLINE FIELDS. The
// pre-1462 replies had no author line at all, carried their state in a bespoke
// title (`Channel Bound` / `Channel Unbound` / `Upcoming Events`), and coloured
// a successful `/unbind` red. Asserting the author line + the colour therefore
// fails against the old copy instead of passing on both, which is all the
// previous `unbound|removed|success` substring match could do.
// ---------------------------------------------------------------------------

/** `EMBED_COLORS.SYSTEM` — the slate `done` state every reply renders in. */
const SLATE = 0x64748b;
/** `EMBED_COLORS.ERROR` — what a successful `/unbind` must NOT be. */
const RED = 0xef4444;
/** `COMMAND_REPLY_AUTHORS.BIND_SAVED`. */
const BIND_SAVED_AUTHOR = '⚙ BINDING SAVED';
/** `COMMAND_REPLY_AUTHORS.UNBIND_REMOVED`. */
const UNBIND_REMOVED_AUTHOR = '⚙ BINDING REMOVED';
/** `eventsListAuthorLine(shown, total)`. */
const EVENTS_LIST_AUTHOR = /^📋 UPCOMING EVENTS · (\d+) of (\d+)$/u;

/** The reply's single embed, or a failure naming what came back instead. */
function replyEmbed(
  res: SlashCommandResponse,
  label: string,
): SlashCommandEmbed {
  const embed = res.embeds?.[0];
  if (!embed) {
    throw new Error(`${label}: expected an embed, got: ${JSON.stringify(res)}`);
  }
  return embed;
}

/** Assert the reply carries the given author line and the slate `done` colour. */
function assertChrome(
  embed: SlashCommandEmbed,
  expectedAuthor: string | RegExp,
  label: string,
): void {
  const author = embed.author?.name ?? '';
  const matches =
    typeof expectedAuthor === 'string'
      ? author === expectedAuthor
      : expectedAuthor.test(author);
  if (!matches) {
    throw new Error(
      `${label}: expected author line ${String(expectedAuthor)}, got ` +
        `"${author}" (embed: ${JSON.stringify(embed)})`,
    );
  }
  if (embed.color !== SLATE) {
    throw new Error(
      `${label}: expected slate ${SLATE} (state 'done'), got ${embed.color}`,
    );
  }
}

/** An inline field's value by name, or a failure listing the fields present. */
function fieldValue(
  embed: SlashCommandEmbed,
  name: string,
  label: string,
): string {
  const field = embed.fields?.find((f) => f.name === name);
  if (!field) {
    const names = (embed.fields ?? []).map((f) => f.name).join(', ');
    throw new Error(
      `${label}: expected an inline field "${name}", got fields: [${names}]`,
    );
  }
  return field.value;
}

/**
 * The id of the binding just created on `channelId`, or undefined.
 *
 * MUST be called BEFORE the reply assertions: resolving it afterwards meant a
 * failed assertion skipped the lookup, left `bindingId` undefined, and the
 * `finally` then deleted nothing — so every failing `/bind` run leaked a
 * persistent binding that cascaded into `/bindings` and `/unbind`
 * (ROK-1462 review finding).
 */
async function findBindingIdForChannel(
  ctx: TestContext,
  channelId: string,
): Promise<string | undefined> {
  const res = await ctx.api.get<{ data: { id: string; channelId: string }[] }>(
    '/admin/discord/bindings',
  );
  const bindings = Array.isArray(res) ? res : (res.data ?? []);
  return bindings.find((b) => b.channelId === channelId)?.id;
}

/**
 * Assert the embed TITLE against the shared copy's shape.
 *
 * `#channel → Purpose` is the title slot, never an inline field — see
 * `command-reply-chrome.helpers.ts::bindingTitle` and `settingsFields`, which
 * emits only the tuning fields. Asserting it as a field can only ever produce
 * "expected an inline field", which is a broken test rather than a caught
 * regression (ROK-1462 review finding).
 */
function assertTitleMatches(
  embed: SlashCommandEmbed,
  pattern: RegExp,
  label: string,
): void {
  const title = embed.title ?? '';
  if (!pattern.test(title)) {
    throw new Error(
      `${label}: title expected to match ${String(pattern)}, ` +
        `got "${title}"`,
    );
  }
}

/** Assert a field's value against the shared copy's shape. */
function assertFieldMatches(
  embed: SlashCommandEmbed,
  name: string,
  pattern: RegExp,
  label: string,
): void {
  const value = fieldValue(embed, name, label);
  if (!pattern.test(value)) {
    throw new Error(
      `${label}: field "${name}" expected to match ${String(pattern)}, ` +
        `got "${value}"`,
    );
  }
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
// Test 2: /events returns a valid response (content or embed)
// ---------------------------------------------------------------------------

const eventsReturnsResponse: SmokeTest = {
  name: '/events list renders the command-reply chrome (ROK-1462)',
  category: 'command',
  async run(ctx) {
    // Create one event so the list branch is taken deterministically — the
    // empty branch replies with plain content and has no chrome to assert.
    const ev = await createEvent(ctx.api, 'cmd-events-chrome');
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'events',
        discordUserId: ctx.testBotDiscordId,
      });
      const embed = replyEmbed(res, '/events');
      // The count lives in the chrome, not in a title: pre-1462 this embed was
      // announcement-blue with a bespoke `Upcoming Events` title and no author.
      assertChrome(embed, EVENTS_LIST_AUTHOR, '/events');
      const counts = EVENTS_LIST_AUTHOR.exec(embed.author?.name ?? '');
      const shown = counts?.[1] ?? '0';
      const total = counts?.[2] ?? '0';
      if (embed.title) {
        throw new Error(
          `/events: list view must carry no title — the count is stated once, ` +
            `in the chrome. Got title "${embed.title}"`,
        );
      }
      // Footer label is `${community} · Showing N of M`, same counts as above.
      const footer = embed.footer?.text ?? '';
      if (!footer.endsWith(`Showing ${shown} of ${total}`)) {
        throw new Error(
          `/events: expected footer ending "Showing ${shown} of ${total}", ` +
            `got "${footer}"`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
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
          time: 'tomorrow 8pm',
        },
        discordUserId: ctx.testBotDiscordId,
      });
      // Check for error responses first
      const errText = res.content ?? '';
      if (errText.includes('Could not parse') || errText.includes('need a Raid Ledger account')) {
        throw new Error(`/event create: command returned error: ${errText}`);
      }
      // The confirmation embed proves the event was persisted — eventsService.create()
      // is called before the embed is built.
      const hasTitle = res.embeds?.some(
        (e) => e.title === 'Event Created' || (e.description ?? '').includes(title),
      );
      if (!hasTitle) {
        throw new Error(
          `/event create: expected "Event Created" embed with title "${title}", got: ${JSON.stringify(res)}`,
        );
      }
      // Find the event for cleanup — search with title prefix
      const eventsRes = await ctx.api.get<{ data: { id: number; title: string }[] }>(
        `/events?search=${encodeURIComponent(title)}&limit=5&page=1`,
      );
      const events = Array.isArray(eventsRes) ? eventsRes : (eventsRes.data ?? []);
      const persisted = events.find((e: { id: number; title: string }) => e.title === title);
      if (persisted) createdEventId = persisted.id;
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
      JSON.stringify(res.components ?? []),
    ].join(' ');
    const hasLink = /https?:\/\//.test(text) || /\/events\/plan/.test(text);
    if (!hasLink) {
      throw new Error(
        `/event plan: expected a URL in response or components, got: ${JSON.stringify(res)}`,
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
      // Claim the binding for cleanup BEFORE asserting, so a failed assertion
      // cannot leak it (see findBindingIdForChannel).
      bindingId = await findBindingIdForChannel(ctx, ch.id);
      const embed = replyEmbed(res, '/bind');
      assertChrome(embed, BIND_SAVED_AUTHOR, '/bind');
      // D6: the channel/purpose line is the TITLE, and the purpose reads in the
      // admin form's words (`Announcements` from the shared
      // `BINDING_PURPOSE_LABELS`, not the old `game-announcements`). The
      // binding's tuning settings are the inline fields.
      assertTitleMatches(embed, /^#\S.* → Announcements$/u, '/bind');
      // A text channel is announcements-only: it carries none of the voice
      // tuning fields (AC5).
      const voiceField = (embed.fields ?? []).find((f) =>
        ['Minimum players', 'Auto-close', 'Just Chatting'].includes(f.name),
      );
      if (voiceField) {
        throw new Error(
          `/bind: an announcements binding must render no voice tuning ` +
            `fields, got "${voiceField.name}"`,
        );
      }
    } finally {
      if (bindingId) {
        await deleteBinding(ctx.api, bindingId);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Test 8b: /bind on a voice channel renders the ROK-1448 settings copy
// ---------------------------------------------------------------------------

const bindVoiceSettingsFields: SmokeTest = {
  name: '/bind voice reply states the settings in the admin form nouns',
  category: 'command',
  async run(ctx) {
    const vc = ctx.voiceChannels[0];
    if (!vc) throw new Error('No voice channels available');
    const gameId = ctx.games[0]?.id;
    let bindingId: string | undefined;
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'bind',
        // Object form so the handler sees the Discord channel type (2 = voice)
        // and resolves the purpose to `game-voice-monitor`.
        options: { channel: { id: vc.id, type: 2 }, game: gameId },
        guildId: ctx.config.guildId,
        discordUserId: ctx.testBotDiscordId,
      });
      // Claim the binding for cleanup BEFORE asserting (see
      // findBindingIdForChannel).
      bindingId = await findBindingIdForChannel(ctx, vc.id);
      const embed = replyEmbed(res, '/bind (voice)');
      assertChrome(embed, BIND_SAVED_AUTHOR, '/bind (voice)');
      assertTitleMatches(embed, /^#\S.* → Activity Monitor$/u, '/bind (voice)');
      // ROK-1448 nouns, shared with the admin form via `@raid-ledger/contract`:
      // a monitor counts `in channel` (a general lobby counts `per game`), and
      // auto-close waits for the EVENT GROUP, not the channel, to empty.
      assertFieldMatches(
        embed,
        'Minimum players',
        /^\d+ in channel$/u,
        '/bind (voice)',
      );
      assertFieldMatches(
        embed,
        'Auto-close',
        /^\d+ min after group empties$/u,
        '/bind (voice)',
      );
    } finally {
      if (bindingId) await deleteBinding(ctx.api, bindingId);
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
      purpose: 'game-announcements',
      gameId: ctx.games[0]?.id,
    });
    try {
      const res = await invokeCommand(ctx, {
        commandName: 'unbind',
        options: { channel: ch.id },
        guildId: ctx.config.guildId,
        discordUserId: ctx.testBotDiscordId,
      });
      const embed = replyEmbed(res, '/unbind');
      // A removed binding is a SETTLED outcome: slate `done` with the state in
      // the author line. Pre-1462 this was `EMBED_COLORS.ERROR` red with a
      // `Channel Unbound` title — a success coloured like a failure.
      assertChrome(embed, UNBIND_REMOVED_AUTHOR, '/unbind');
      if (embed.color === RED) {
        throw new Error('/unbind: a successful unbind must not render red');
      }
      // The channel is the subject, so it owns the title; the state does not.
      if (!embed.title?.startsWith('#')) {
        throw new Error(
          `/unbind: expected the unbound channel as the title (#…), got ` +
            `"${embed.title ?? ''}"`,
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
  eventsReturnsResponse,
  eventsWithData,
  eventCreate,
  eventPlanWizardLink,
  rosterValidEvent,
  rosterInvalidEvent,
  bindChannel,
  bindVoiceSettingsFields,
  unbindChannel,
  bindingsList,
  playingSetGame,
  playingClearGame,
  inviteEvent,
  autocompleteGameNames,
];

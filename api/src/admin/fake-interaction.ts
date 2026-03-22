/**
 * Fake Discord interaction objects for testing slash commands
 * without a live Discord connection.
 *
 * Used by SlashCommandTestService to invoke command handlers
 * and capture their responses in a serializable format.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapturedResponse {
  content?: string;
  embeds?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  deferred?: boolean;
}

interface NoopCollector {
  on: (_event: string, _handler: (...args: unknown[]) => void) => NoopCollector;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Noop collector — satisfies createMessageComponentCollector()
// ---------------------------------------------------------------------------

function createNoopCollector(): NoopCollector {
  return {
    on: () => createNoopCollector(),
    stop: () => {},
  };
}

// ---------------------------------------------------------------------------
// Options proxy — getString, getInteger, getSubcommand, etc.
// ---------------------------------------------------------------------------

function getStringOption(opts: Record<string, unknown>, name: string) {
  return (opts[name] as string | null) ?? null;
}

function getIntegerOption(opts: Record<string, unknown>, name: string) {
  const val = opts[name];
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return val;
  return parseInt(val as string, 10);
}

function getChannelOption(opts: Record<string, unknown>, name: string) {
  const val = opts[name];
  if (!val) return null;
  const id = typeof val === 'string' ? val : (val as { id: string }).id;
  return { id, name: `channel-${id}` };
}

function getUserOption(opts: Record<string, unknown>, name: string) {
  const val = opts[name];
  if (!val) return null;
  const id = typeof val === 'string' ? val : (val as { id: string }).id;
  return { id, username: `user-${id}` };
}

function getFocusedOption(opts: Record<string, unknown>, full?: boolean) {
  if (full) {
    return {
      name: (opts._focusedName as string) ?? '',
      value: (opts._focusedValue as string) ?? '',
    };
  }
  return (opts._focusedValue as string) ?? '';
}

export function buildOptionsProxy(
  opts: Record<string, unknown>,
  subcommand?: string,
) {
  return {
    getString: (name: string) => getStringOption(opts, name),
    getInteger: (name: string) => getIntegerOption(opts, name),
    getSubcommand: () => subcommand ?? '',
    getChannel: (name: string) => getChannelOption(opts, name),
    getUser: (name: string) => getUserOption(opts, name),
    getFocused: (full?: boolean) => getFocusedOption(opts, full),
  };
}

// ---------------------------------------------------------------------------
// FakeInteraction — ChatInputCommandInteraction mock
// ---------------------------------------------------------------------------

export class FakeInteraction {
  readonly commandName: string;
  readonly guildId: string | null;
  readonly user: { id: string; username: string };
  readonly channel: { id: string };
  readonly options: ReturnType<typeof buildOptionsProxy>;
  readonly captured: CapturedResponse[] = [];
  replied = false;
  deferred = false;

  constructor(params: {
    commandName: string;
    guildId?: string;
    discordUserId?: string;
    channelId?: string;
    options?: Record<string, unknown>;
    subcommand?: string;
  }) {
    this.commandName = params.commandName;
    this.guildId = params.guildId ?? null;
    this.user = {
      id: params.discordUserId ?? '000000000000000000',
      username: 'test-user',
    };
    this.channel = { id: params.channelId ?? '000000000000000001' };
    this.options = buildOptionsProxy(params.options ?? {}, params.subcommand);
  }

  reply(data: unknown): Promise<void> {
    this.replied = true;
    this.captured.push(serializeReplyData(data));
    return Promise.resolve();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deferReply(data?: unknown): Promise<void> {
    this.deferred = true;
    return Promise.resolve();
  }

  editReply(
    data: unknown,
  ): Promise<{ createMessageComponentCollector: () => NoopCollector }> {
    this.captured.push(serializeReplyData(data));
    return Promise.resolve({
      createMessageComponentCollector: createNoopCollector,
    });
  }

  followUp(data: unknown): Promise<void> {
    this.captured.push(serializeReplyData(data));
    return Promise.resolve();
  }

  /** Build a unified response from all captured reply data. */
  toResponse(): CapturedResponse {
    return mergeCaptures(this.captured, this.deferred);
  }
}

// ---------------------------------------------------------------------------
// FakeAutocompleteInteraction
// ---------------------------------------------------------------------------

export class FakeAutocompleteInteraction {
  readonly commandName: string;
  readonly user: { id: string };
  readonly options: ReturnType<typeof buildOptionsProxy>;
  capturedChoices: { name: string; value: unknown }[] = [];

  constructor(params: {
    commandName: string;
    focusedOption: string;
    value: string;
    subcommand?: string;
    discordUserId?: string;
    guildId?: string;
  }) {
    this.commandName = params.commandName;
    this.user = { id: params.discordUserId ?? '000000000000000000' };
    this.options = buildOptionsProxy(
      {
        _focusedName: params.focusedOption,
        _focusedValue: params.value,
      },
      params.subcommand,
    );
  }

  respond(choices: { name: string; value: unknown }[]): Promise<void> {
    this.capturedChoices = choices;
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function serializeReplyData(data: unknown): CapturedResponse {
  if (typeof data === 'string') return { content: data };
  const obj = data as Record<string, unknown>;
  return {
    content: obj.content as string | undefined,
    embeds: serializeEmbeds(obj.embeds),
    components: serializeComponents(obj.components),
  };
}

interface Serializable {
  toJSON: () => Record<string, unknown>;
}

function hasToJSON(val: unknown): val is Serializable {
  return typeof val === 'object' && val !== null && 'toJSON' in val;
}

function serializeEmbeds(
  embeds: unknown,
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(embeds) || embeds.length === 0) return undefined;
  return embeds.map((e: unknown) =>
    hasToJSON(e) ? e.toJSON() : (e as Record<string, unknown>),
  );
}

function serializeComponents(
  components: unknown,
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(components) || components.length === 0) return undefined;
  return components.map((c: unknown) =>
    hasToJSON(c) ? c.toJSON() : (c as Record<string, unknown>),
  );
}

function mergeCaptures(
  captures: CapturedResponse[],
  deferred: boolean,
): CapturedResponse {
  const result: CapturedResponse = { deferred };
  for (const c of captures) {
    if (c.content) result.content = c.content;
    if (c.embeds) result.embeds = c.embeds;
    if (c.components) result.components = c.components;
  }
  return result;
}

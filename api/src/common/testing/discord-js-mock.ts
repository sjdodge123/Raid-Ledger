/**
 * Shared mock for discord.js used across notification embed test files.
 *
 * Usage in spec files:
 *   jest.mock('discord.js', () => {
 *     // eslint-disable-next-line @typescript-eslint/no-require-imports
 *     return require('../common/testing/discord-js-mock').discordJsMock;
 *   });
 */

class MockEmbedBuilder {
  private data: Record<string, unknown> = {};

  setAuthor(author: unknown) {
    this.data.author = author;
    return this;
  }
  setTitle(title: string) {
    this.data.title = title;
    return this;
  }
  setDescription(description: string) {
    this.data.description = description;
    return this;
  }
  setColor(color: number) {
    this.data.color = color;
    return this;
  }
  setFooter(footer: unknown) {
    this.data.footer = footer;
    return this;
  }
  setTimestamp(ts?: Date) {
    this.data.timestamp = ts ?? new Date();
    return this;
  }
  addFields(...fields: unknown[]) {
    if (!this.data.fields) this.data.fields = [];
    (this.data.fields as unknown[]).push(...fields);
    return this;
  }
  toJSON() {
    return this.data;
  }
}

class MockButtonBuilder {
  private data: Record<string, unknown> = {};

  setCustomId(customId: string) {
    this.data.customId = customId;
    return this;
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: number) {
    this.data.style = style;
    return this;
  }
  setURL(url: string) {
    this.data.url = url;
    return this;
  }
  setEmoji(emoji: string) {
    this.data.emoji = emoji;
    return this;
  }
  setDisabled(disabled: boolean) {
    this.data.disabled = disabled;
    return this;
  }
  toJSON() {
    return this.data;
  }
}

class MockActionRowBuilder {
  private components: Array<{ toJSON: () => unknown }> = [];

  addComponents(
    ...args: Array<{ toJSON: () => unknown } | Array<{ toJSON: () => unknown }>>
  ) {
    for (const arg of args) {
      if (Array.isArray(arg)) {
        this.components.push(...arg);
      } else {
        this.components.push(arg);
      }
    }
    return this;
  }
  toJSON() {
    return { components: this.components.map((c) => c.toJSON()) };
  }
}

export const discordJsMock = {
  EmbedBuilder: MockEmbedBuilder,
  ButtonBuilder: MockButtonBuilder,
  ActionRowBuilder: MockActionRowBuilder,
  ButtonStyle: { Link: 5, Danger: 4, Secondary: 2, Success: 3 },
};

/** Extended mock including Client, GatewayIntentBits, Events, and PermissionsBitField */
export const discordJsFullMock = {
  ...discordJsMock,
  Client: class MockClient {
    login = jest.fn().mockResolvedValue(undefined);
    destroy = jest.fn().mockResolvedValue(undefined);
    isReady = jest.fn().mockReturnValue(false);
  },
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    GuildMembers: 4,
    DirectMessages: 64,
  },
  Events: { ClientReady: 'ready', Error: 'error' },
  PermissionsBitField: {
    Flags: {
      ManageRoles: BigInt(268435456),
      ManageChannels: BigInt(16),
      CreateInstantInvite: BigInt(1),
      ViewChannel: BigInt(1024),
      SendMessages: BigInt(2048),
      EmbedLinks: BigInt(16384),
      ReadMessageHistory: BigInt(65536),
      SendPolls: BigInt(0),
      AttachFiles: BigInt(32768),
      AddReactions: BigInt(64),
      UseExternalEmojis: BigInt(262144),
      MentionEveryone: BigInt(131072),
      ManageMessages: BigInt(8192),
    },
  },
};

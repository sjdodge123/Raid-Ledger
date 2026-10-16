/**
 * ROK-1788 L4 — DEMO_MODE fixture channels for the guild channel mirror.
 *
 * Only `POST /admin/test/wow/guild-discord-channel` (JWT + admin + DEMO_MODE
 * guards) ever writes here, so in production the registry is always empty and
 * every lookup is a miss. A registered channel stands in for a bot-readable
 * text channel even when no bot is connected (GitHub's Playwright job has
 * none): the picker lists it, a PUT accepts it, and a read returns its literal
 * state without calling Discord. In-memory, like the cache it sits beside — a
 * restart forgets it.
 */
import type { GuildDiscordChannelOptionDto } from '@raid-ledger/contract';
import type { ChannelMirrorRead } from './channel-mirror.read';

/** One fabricated channel: its picker option and what a read returns. */
export interface DemoMirrorChannel {
  option: GuildDiscordChannelOptionDto;
  read: ChannelMirrorRead;
}

export class ChannelMirrorDemoChannels {
  private readonly channels = new Map<string, DemoMirrorChannel>();

  /** Register or replace a channel (keyed on its id). */
  set(channel: DemoMirrorChannel): void {
    this.channels.set(channel.option.id, channel);
  }

  /** Forget a channel; true when it was registered. */
  remove(channelId: string): boolean {
    return this.channels.delete(channelId);
  }

  get(channelId: string): DemoMirrorChannel | null {
    return this.channels.get(channelId) ?? null;
  }

  /** Picker options — only channels whose read is `ok` count as readable. */
  readableOptions(): GuildDiscordChannelOptionDto[] {
    return [...this.channels.values()]
      .filter((channel) => channel.read.state === 'ok')
      .map((channel) => channel.option);
  }
}

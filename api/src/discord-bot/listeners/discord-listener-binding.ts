import type { Logger } from '@nestjs/common';
import type { Client, ClientEvents } from 'discord.js';

/**
 * Minimal structural view of the discord.js gateway emitter.
 *
 * `Client#on` / `Client#removeListener` are heavily-overloaded generics that
 * cannot be indexed by a `keyof ClientEvents` *union*, which is what a generic
 * binding store necessarily holds. Narrowing to this shape keeps the cast in
 * exactly one place instead of at every call site.
 */
interface GatewayEmitter {
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

type GatewayHandler = (...args: never[]) => void;

/** A gateway event name paired with the handler to attach for it. */
export interface GatewayBinding {
  event: keyof ClientEvents;
  handler: GatewayHandler;
}

interface AttachedBinding extends GatewayBinding {
  emitter: GatewayEmitter;
}

/**
 * Type-safe factory for a {@link GatewayBinding} — the handler's arguments are
 * inferred from the event name, so call sites keep full discord.js typing.
 */
export function gatewayBinding<E extends keyof ClientEvents>(
  event: E,
  handler: (...args: ClientEvents[E]) => void,
): GatewayBinding {
  return { event, handler: handler as GatewayHandler };
}

/**
 * Owns the attach/detach lifecycle of a listener's discord.js gateway handlers
 * (ROK-1425).
 *
 * Listeners that only attach on `DISCORD_BOT_EVENTS.CONNECTED` and never detach
 * have two failure modes, both of which end with Discord's red
 * "This interaction failed" banner because nothing ever acks the interaction:
 *
 * 1. **Orphaned handler** — the handler stays bound to a client that was
 *    destroyed during a reconnect, so it never sees the live gateway again.
 * 2. **Stacked handlers** — CONNECTED fires twice on the same client and the
 *    handler is registered twice, doubling every side effect.
 *
 * `attach()` always detaches first, and `detach()` removes each handler from
 * the exact emitter it was attached to, so both are structurally impossible.
 */
export class DiscordListenerBinding {
  private attached: AttachedBinding[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly label: string,
  ) {}

  /** How many gateway handlers are live right now. */
  get attachedCount(): number {
    return this.attached.length;
  }

  /**
   * Detach whatever is currently bound, then bind `bindings` to `client`.
   *
   * Idempotent per CONNECTED emission: calling it repeatedly (double-CONNECTED,
   * or CONNECTED after a missed DISCONNECTED) leaves exactly one live handler
   * per event, always on the newest client.
   */
  attach(client: Client, bindings: GatewayBinding[]): void {
    this.detach();
    const emitter = client as unknown as GatewayEmitter;
    for (const binding of bindings) {
      emitter.on(binding.event, binding.handler);
      this.attached.push({ ...binding, emitter });
    }
    this.logger.log(
      `${this.label}: attached ${bindings.length} gateway handler(s) [${bindings
        .map((b) => b.event)
        .join(', ')}]`,
    );
  }

  /**
   * Attach to the bot's live client, or warn when there isn't one. Returns
   * false when nothing was attached — a silent `return` here is precisely how
   * a dead button flow goes unnoticed in a prod log export.
   */
  attachToClient(client: Client | null, bindings: GatewayBinding[]): boolean {
    if (!client) {
      this.logger.warn(
        `${this.label}: Discord client unavailable — handlers not registered`,
      );
      return false;
    }
    this.attach(client, bindings);
    return true;
  }

  /** Remove every handler from the exact client it was attached to. */
  detach(): void {
    if (this.attached.length === 0) return;
    const count = this.attached.length;
    for (const binding of this.attached) {
      try {
        binding.emitter.removeListener(binding.event, binding.handler);
      } catch {
        // A destroyed client can throw here; the reference is dropped below
        // regardless, so the handler can never be re-used.
      }
    }
    this.attached = [];
    this.logger.log(`${this.label}: detached ${count} gateway handler(s)`);
  }
}

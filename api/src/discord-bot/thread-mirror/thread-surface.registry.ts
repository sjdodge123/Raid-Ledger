/**
 * ROK-1483 D2 — the `(surface_kind, surface_id) <-> thread_id` registry.
 *
 * DERIVED, not stored. There is no registry table: each resolver reads the
 * table that already owns the binding. A second table would need a dual-write
 * on every post / repost / heal path and would silently drift the first time
 * one of them was edited; a derivation cannot drift.
 *
 * This interface is the whole ROK-1484 extension seam. Adding lineups, polls
 * or events is one new file plus one `register()` call — no controller, no
 * service and no React component changes.
 */
import { Injectable } from '@nestjs/common';
import type {
  ThreadSurfaceKind,
  ThreadSurfaceRef,
} from '@raid-ledger/contract';

/** Where a thread lives, as the Open-in-Discord url needs it. */
export interface ResolvedThread {
  threadId: string;
  guildId: string;
}

/** What one surface kind must be able to answer about its threads. */
export interface SurfaceResolver {
  /** The thread bound to a surface, or null when it has none. */
  resolveThread(surfaceId: string): Promise<ResolvedThread | null>;
  /** The surface a thread belongs to, or null when this kind does not own it. */
  resolveSurface(threadId: string): Promise<ThreadSurfaceRef | null>;
  /** Whether this user may read that surface's conversation. */
  canView(userId: number, surfaceId: string): Promise<boolean>;
  /**
   * Threads this kind wants re-walked on `DISCORD_BOT_EVENTS.CONNECTED` (D14).
   *
   * Optional so a kind whose threads are all short-lived can opt out. It lives
   * on the resolver rather than in the mirror service so ROK-1484 stays what
   * D2 promises — one new file and one `register()` call, with no edit to the
   * service, which would otherwise have to learn every surface's "still live"
   * predicate.
   */
  listActiveThreads?(): Promise<ResolvedThread[]>;
}

/** Registry of the per-surface-kind resolvers. */
@Injectable()
export class ThreadSurfaceRegistry {
  private readonly resolvers = new Map<ThreadSurfaceKind, SurfaceResolver>();

  /**
   * Bind a resolver to a surface kind. Registering a kind twice replaces it.
   *
   * @param kind - The surface kind this resolver owns.
   * @param resolver - The resolver.
   */
  register(kind: ThreadSurfaceKind, resolver: SurfaceResolver): void {
    this.resolvers.set(kind, resolver);
  }

  /**
   * The surface a thread belongs to, asking every registered kind.
   *
   * A null answer means the thread is not app-owned, which the read endpoint
   * turns into a 403 rather than a 404 — a 404 would confirm to an attacker
   * that a given thread id is unknown to us.
   *
   * @param threadId - The Discord thread id.
   * @returns The owning surface, or null.
   */
  async resolveSurface(threadId: string): Promise<ThreadSurfaceRef | null> {
    for (const resolver of this.resolvers.values()) {
      const surface = await resolver.resolveSurface(threadId);
      if (surface) return surface;
    }
    return null;
  }

  /**
   * The thread bound to a surface.
   *
   * @param kind - The surface kind.
   * @param surfaceId - The surface's id, as a string.
   * @returns The thread, or null when the kind is unregistered or unbound.
   */
  async resolveThread(
    kind: ThreadSurfaceKind,
    surfaceId: string,
  ): Promise<ResolvedThread | null> {
    return (await this.resolvers.get(kind)?.resolveThread(surfaceId)) ?? null;
  }

  /**
   * Every thread that should be reconciled when the bot reconnects (D14).
   *
   * @returns Threads across all registered kinds; kinds that opt out add none.
   */
  async listActiveThreads(): Promise<ResolvedThread[]> {
    const perKind = await Promise.all(
      [...this.resolvers.values()].map(
        async (resolver) => (await resolver.listActiveThreads?.()) ?? [],
      ),
    );
    return perKind.flat();
  }

  /**
   * Whether a user may read a surface's conversation.
   *
   * Denies by default: an unregistered kind is not viewable.
   *
   * @param kind - The surface kind.
   * @param surfaceId - The surface's id.
   * @param userId - The authenticated caller.
   * @returns True when the caller may read.
   */
  async canView(
    kind: ThreadSurfaceKind,
    surfaceId: string,
    userId: number,
  ): Promise<boolean> {
    return (
      (await this.resolvers.get(kind)?.canView(userId, surfaceId)) ?? false
    );
  }
}

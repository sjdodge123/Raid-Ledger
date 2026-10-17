import {
  SESSION_TTL_MS,
  SESSION_SWEEP_INTERVAL_MS,
} from '../ai-chat.constants';
import type { TreeSession } from '../tree/tree.types';

/**
 * In-memory session store for AI chat tree navigation.
 * Sessions expire after 5 minutes of inactivity.
 */
export class AiChatSessionStore {
  private readonly sessions = new Map<string, TreeSession>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Start the periodic cleanup timer. */
  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(
      () => this.sweep(),
      SESSION_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref();
  }

  /** Stop the cleanup timer and clear all sessions. */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.sessions.clear();
  }

  /** Get a session for a user, returning null if expired or absent. */
  get(userId: string): TreeSession | null {
    const session = this.sessions.get(userId);
    if (!session) return null;
    if (Date.now() - session.lastActiveAt > SESSION_TTL_MS) {
      this.sessions.delete(userId);
      return null;
    }
    return session;
  }

  /** Create or replace a session for a user. */
  set(userId: string, session: TreeSession): void {
    this.sessions.set(userId, session);
  }

  /** Update the lastActiveAt timestamp. */
  touch(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) session.lastActiveAt = Date.now();
  }

  /** Remove a session explicitly. */
  clear(userId: string): void {
    this.sessions.delete(userId);
  }

  /** Remove all expired sessions. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

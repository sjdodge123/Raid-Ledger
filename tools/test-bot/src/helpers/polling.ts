/**
 * Polling utilities for Discord smoke tests.
 * Replaces fixed sleep() calls with adaptive polling that uses
 * exponential backoff and deadline-aware timeouts.
 */
import { type Message, type PartialMessage } from 'discord.js';
import { getClient } from '../client.js';
import { readLastMessages, toSimpleMessage, type SimpleMessage } from './messages.js';

/** Options for pollForEmbed. */
export interface PollOptions {
  /** Initial poll interval in ms (default 2000). */
  intervalMs?: number;
  /** Enable exponential backoff (default true). */
  backoff?: boolean;
  /** Max messages to fetch per poll (default 50). */
  fetchCount?: number;
}

const DEFAULT_INTERVAL = 2000;
const MAX_INTERVAL = 8000;

/**
 * Poll a channel for a message matching a predicate.
 * Uses exponential backoff (2s -> 4s -> 8s cap) by default.
 * Returns the matching message or throws on timeout.
 */
export async function pollForEmbed(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  timeoutMs: number,
  opts?: PollOptions,
): Promise<SimpleMessage> {
  const interval = opts?.intervalMs ?? DEFAULT_INTERVAL;
  const useBackoff = opts?.backoff ?? true;
  const fetchCount = opts?.fetchCount ?? 50;
  const deadline = Date.now() + timeoutMs;
  let currentInterval = interval;

  while (Date.now() < deadline) {
    const msgs = await readLastMessages(channelId, fetchCount);
    const match = msgs.find(predicate);
    if (match) return match;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const waitTime = Math.min(currentInterval, remaining);
    await delay(waitTime);

    if (useBackoff) {
      currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
    }
  }

  throw new Error(
    `pollForEmbed timed out after ${timeoutMs}ms on channel ${channelId}`,
  );
}

/**
 * Wait for a message update (edit) matching a predicate.
 * Combines an event listener with polling fallback — whichever
 * fires first wins, eliminating the race condition in pure
 * event-driven approaches.
 */
export async function waitForEmbedUpdate(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  timeoutMs = 30_000,
): Promise<SimpleMessage> {
  const client = getClient();
  const deadline = Date.now() + timeoutMs;

  return new Promise<SimpleMessage>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      client.off('messageUpdate', onUpdate);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`waitForEmbedUpdate timed out after ${timeoutMs}ms on ${channelId}`),
      );
    }, timeoutMs);

    const settle = (msg: SimpleMessage) => {
      if (settled) return;
      clearTimeout(timer);
      cleanup();
      resolve(msg);
    };

    // Strategy 1: Listen for real-time message edits
    function onUpdate(
      _old: Message | PartialMessage,
      updated: Message | PartialMessage,
    ) {
      if (settled || updated.channelId !== channelId) return;
      if (!updated.author || updated.partial) return;
      const simple = toSimpleMessage(updated as Message);
      try {
        if (predicate(simple)) settle(simple);
      } catch { /* predicate threw — not a match */ }
    }

    client.on('messageUpdate', onUpdate);

    // Strategy 2: Poll as fallback (catches edits before listener)
    void pollFallback(channelId, predicate, deadline, settle);
  });
}

/**
 * Internal polling fallback for waitForEmbedUpdate.
 * Polls at 2s intervals until deadline or until settle is called.
 */
async function pollFallback(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  deadline: number,
  settle: (msg: SimpleMessage) => void,
): Promise<void> {
  let interval = DEFAULT_INTERVAL;
  while (Date.now() < deadline) {
    const msgs = await readLastMessages(channelId, 50);
    const match = msgs.find(predicate);
    if (match) {
      settle(match);
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await delay(Math.min(interval, remaining));
    interval = Math.min(interval * 2, MAX_INTERVAL);
  }
}

/**
 * Generic condition poller for non-embed use cases
 * (e.g., waiting for notification counts, API state changes).
 * Calls the async check function at intervals until it returns
 * a truthy value or the timeout expires.
 */
export async function pollForCondition<T>(
  check: () => Promise<T | null | undefined>,
  timeoutMs: number,
  opts?: { intervalMs?: number; backoff?: boolean },
): Promise<T> {
  const interval = opts?.intervalMs ?? DEFAULT_INTERVAL;
  const useBackoff = opts?.backoff ?? true;
  const deadline = Date.now() + timeoutMs;
  let currentInterval = interval;

  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await delay(Math.min(currentInterval, remaining));

    if (useBackoff) {
      currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
    }
  }

  throw new Error(`pollForCondition timed out after ${timeoutMs}ms`);
}

/** Simple delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

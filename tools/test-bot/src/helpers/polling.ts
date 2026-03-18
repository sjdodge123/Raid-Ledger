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
  /** Max messages to fetch per poll (default 100). */
  fetchCount?: number;
}

const DEFAULT_INTERVAL = 2000;
const MAX_INTERVAL = 8000;
const POLL_FALLBACK_INTERVAL = 3000;
const DEFAULT_FETCH_COUNT = 100;

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
  const fetchCount = opts?.fetchCount ?? DEFAULT_FETCH_COUNT;
  const deadline = Date.now() + timeoutMs;
  let currentInterval = interval;

  while (Date.now() < deadline) {
    const msgs = await readLastMessages(channelId, fetchCount);
    const match = msgs.find(predicate);
    if (match) return match;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await delay(Math.min(currentInterval, remaining));

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

    const onUpdate = buildUpdateHandler(channelId, predicate, settle, () => settled);
    client.on('messageUpdate', onUpdate);

    // Poll as fallback (catches edits that arrived before listener)
    void pollFallback(channelId, predicate, deadline, settle, () => settled);
  });
}

/** Build a messageUpdate handler that checks edits against a predicate. */
function buildUpdateHandler(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  settle: (msg: SimpleMessage) => void,
  isSettled: () => boolean,
) {
  return function onUpdate(
    _old: Message | PartialMessage,
    updated: Message | PartialMessage,
  ) {
    if (isSettled() || updated.channelId !== channelId) return;
    if (updated.partial) {
      void fetchAndCheck(updated, predicate, settle, isSettled);
      return;
    }
    if (!updated.author) return;
    const simple = toSimpleMessage(updated as Message);
    try {
      if (predicate(simple)) settle(simple);
    } catch { /* predicate threw — not a match */ }
  };
}

/** Fetch full message for partials and check against predicate. */
function fetchAndCheck(
  partial: Message | PartialMessage,
  predicate: (msg: SimpleMessage) => boolean,
  settle: (msg: SimpleMessage) => void,
  isSettled: () => boolean,
): void {
  void partial.fetch().then((full) => {
    if (isSettled()) return;
    const simple = toSimpleMessage(full);
    try { if (predicate(simple)) settle(simple); } catch { /* skip */ }
  }).catch(() => { /* fetch failed — polling fallback will catch it */ });
}

/**
 * Internal polling fallback for waitForEmbedUpdate.
 * Only matches messages that have been edited (editedAt is set),
 * preventing false matches on the pre-update message.
 * Stops early when the promise has already settled.
 */
async function pollFallback(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  deadline: number,
  settle: (msg: SimpleMessage) => void,
  isSettled: () => boolean,
): Promise<void> {
  while (Date.now() < deadline && !isSettled()) {
    const msgs = await readLastMessages(channelId, DEFAULT_FETCH_COUNT);
    const match = msgs.find((m) => m.editedAt !== null && predicate(m));
    if (match) {
      settle(match);
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0 || isSettled()) return;
    await delay(Math.min(POLL_FALLBACK_INTERVAL, remaining));
  }
}

/**
 * Generic condition poller for non-embed use cases
 * (e.g., waiting for notification counts, API state changes).
 * Calls the async check function at intervals until it returns
 * a non-null/non-undefined value or the timeout expires.
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
    if (result != null) return result;

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

import type {
  GameLogParser,
  GameLogParserSession,
} from '../../plugin-host/extension-points';
import { errName, safeParse } from './pelican-presence.helpers';
import type {
  GamePresenceEvent,
  GamePresenceEventKind,
} from './presence-events';

/** Lifecycle events after which a parser session's memory is stale. */
const RESET_AFTER: ReadonlySet<GamePresenceEventKind> = new Set([
  'server-ready',
  'server-stopping',
]);

export interface PresenceLineParserOptions {
  source: { pelicanServerId: number };
  parser: GameLogParser;
  logger: { warn(message: string): void };
}

/**
 * ROK-2233: one server's view of its game's log parser. A parser with
 * `createSession` gets a session of its own, replaced by `reset()` (a new
 * socket connection, a stopped status) and after a ready/stopping event, so
 * state never crosses servers or a gap in the console stream. A token refresh
 * on the same socket keeps it. A stateless parser passes through unchanged.
 * Like `safeParse`, a raw line never reaches a log.
 */
export class PresenceLineParser {
  private current: GameLogParserSession;
  /** A failing `createSession` is reported once, not on every reset. */
  private warned = false;

  constructor(private readonly opts: PresenceLineParserOptions) {
    this.current = this.open();
  }

  parse(line: string): GamePresenceEvent | null {
    const { source, logger } = this.opts;
    const event = safeParse({ source, logger, parser: this.current }, line);
    if (event && RESET_AFTER.has(event.kind)) this.reset();
    return event;
  }

  /** Forget everything: the next line starts a fresh session. */
  reset(): void {
    if (this.opts.parser.createSession) this.current = this.open();
  }

  /** A session that cannot be created falls back to the stateless `parse`. */
  private open(): GameLogParserSession {
    const { parser, source, logger } = this.opts;
    if (!parser.createSession) return parser;
    try {
      return parser.createSession();
    } catch (err) {
      if (this.warned) return parser;
      this.warned = true;
      logger.warn(
        `Presence parser session failed for server ${source.pelicanServerId}: ${errName(err)}; parsing statelessly`,
      );
      return parser;
    }
  }
}

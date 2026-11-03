import type { Logger } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Socket } from 'socket.io';
import type * as schema from '../drizzle/schema';
import {
  validateSessionPayload,
  type SessionJwtPayload,
} from './session-auth.helpers';

export interface SocketAuthDeps {
  jwtService: JwtService;
  db: PostgresJsDatabase<typeof schema>;
  logger: Logger;
}

/** The bearer a socket.io client sends in `handshake.auth.token`. */
function handshakeToken(client: Socket): string | null {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  const token = auth?.token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function reject(client: Socket, logger: Logger, reason: string): false {
  logger.debug(`Client ${client.id} rejected: ${reason}`);
  return false;
}

/**
 * Socket handshake auth: the JWT signature, then the SAME session checks the
 * HTTP `JwtStrategy` runs (magic-link refusal, token version, ban / kick /
 * deactivation, impersonator standing). Returns whether the client may
 * connect; the reason for a refusal is logged, never sent to the client.
 */
export async function authenticateSocket(
  client: Socket,
  deps: SocketAuthDeps,
): Promise<boolean> {
  const token = handshakeToken(client);
  if (!token) return reject(client, deps.logger, 'no auth token provided');
  try {
    const payload = deps.jwtService.verify<SessionJwtPayload>(token);
    await validateSessionPayload(deps.db, payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'invalid auth token';
    return reject(client, deps.logger, reason);
  }
  deps.logger.debug(`Client ${client.id} connected with valid token`);
  return true;
}

/** The error a refused handshake gets (socket.io's `connect_error`). */
export const SOCKET_UNAUTHORIZED = 'unauthorized';

/** A socket.io namespace middleware. */
export type SocketAuthMiddleware = (
  socket: Socket,
  next: (err?: Error) => void,
) => void;

/**
 * Socket.IO middleware running {@link authenticateSocket} BEFORE the socket
 * connects (register it in a gateway's `afterInit` with `server.use`). A
 * refused handshake gets `next(err)`, so an unauthenticated client never
 * joins the namespace and can never subscribe or emit — there is no window
 * between connecting and an async check disconnecting it.
 */
export function socketAuthMiddleware(
  deps: SocketAuthDeps,
): SocketAuthMiddleware {
  return (socket, next) => {
    authenticateSocket(socket, deps).then(
      (ok) => next(ok ? undefined : new Error(SOCKET_UNAUTHORIZED)),
      () => next(new Error(SOCKET_UNAUTHORIZED)),
    );
  };
}

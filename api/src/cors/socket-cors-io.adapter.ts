/**
 * The app's socket.io adapter: Nest's `IoAdapter` with the CORS decision
 * replaced by `socketCorsDelegate`, so every namespace on the shared server
 * gets the same Host-aware policy as HTTP (see `socket-cors.ts`).
 */
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import { socketCorsDelegate } from './socket-cors';

/** `IoAdapter` whose server always uses the handshake-time CORS delegate. */
export class SocketCorsIoAdapter extends IoAdapter {
  /** Builds the server with any gateway-supplied `cors` replaced. */
  override createIOServer(
    port: number,
    options?: Partial<ServerOptions>,
  ): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: socketCorsDelegate,
    });
    return server;
  }
}

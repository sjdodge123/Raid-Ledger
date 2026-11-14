import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketManager } from '@discordjs/ws';
import { REST } from 'discord.js';
import { WebSocket, WebSocketServer } from 'ws';
import {
  TrackingShardingStrategy,
  type GatewayShard,
} from './discord-bot-client.shards.helpers';

/**
 * ROK-2198: drives the REAL @discordjs/ws manager + shard against a loopback
 * gateway (HELLO on connect, READY on IDENTIFY) — no Discord, no network.
 */

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}

interface Gateway {
  server: WebSocketServer;
  sockets: WebSocket[];
  url: string;
}

function answer(socket: WebSocket, raw: string, url: string): void {
  const { op } = JSON.parse(raw) as { op: number };
  if (op === 1) socket.send(JSON.stringify({ op: 11 }));
  if (op !== 2) return;
  const d = {
    v: 10,
    user: { id: '1', username: 'bot', discriminator: '0', avatar: null },
    guilds: [],
    session_id: 'session',
    resume_gateway_url: url,
    shard: [0, 1],
    application: { id: '1', flags: 0 },
  };
  socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d }));
}

async function startGateway(): Promise<Gateway> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const gateway: Gateway = {
    server,
    sockets: [],
    url: `ws://127.0.0.1:${port}`,
  };
  server.on('connection', (socket) => {
    gateway.sockets.push(socket);
    socket.on('message', (raw) =>
      answer(
        socket,
        Buffer.isBuffer(raw) ? raw.toString('utf8') : '',
        gateway.url,
      ),
    );
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
  });
  return gateway;
}

function buildManager(gateway: Gateway) {
  const built: { strategy?: TrackingShardingStrategy } = {};
  const manager = new WebSocketManager({
    token: 'test-token',
    intents: 0,
    rest: new REST(),
    shardCount: 1,
    shardIds: [0],
    compression: null,
    buildStrategy: (m) => (built.strategy = new TrackingShardingStrategy(m)),
    buildIdentifyThrottler: () => ({
      waitForIdentify: () => Promise.resolve(),
    }),
  });
  jest.spyOn(manager, 'fetchGatewayInformation').mockResolvedValue({
    url: gateway.url,
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: 1000,
      reset_after: 0,
      max_concurrency: 1,
    },
  });
  return { manager, strategy: must(built.strategy, 'strategy') };
}

const next = (shard: GatewayShard, event: string): Promise<void> =>
  new Promise((resolve) => shard.on(event, () => resolve()));

describe('TrackingShardingStrategy (real @discordjs/ws shard)', () => {
  let gateway: Gateway;
  let manager: WebSocketManager;

  beforeEach(async () => {
    gateway = await startGateway();
  });

  afterEach(async () => {
    await manager.destroy();
    for (const socket of gateway.sockets) socket.terminate();
    gateway.server.close();
    jest.restoreAllMocks();
  });

  it('closes a shard that reconnects after the strategy was destroyed', async () => {
    const built = buildManager(gateway);
    manager = built.manager;
    await manager.connect();
    const shard = must(built.strategy.allShards()[0], 'shard');
    const first = must(gateway.sockets[0], 'first socket');

    // Discord drops the session; the shard schedules its own reconnect…
    const shardSawClose = next(shard, 'closed');
    const reconnected = once(gateway.server, 'connection');
    first.close(1000);
    await shardSawClose;
    // …and discord.js destroys the manager meanwhile (login()'s catch).
    await manager.destroy();
    const [orphan] = (await reconnected) as [WebSocket];
    await next(shard, 'ready');
    await built.strategy.settled();

    expect(orphan.readyState).not.toBe(WebSocket.OPEN);
    expect(shard.status).toBe(0);
  });

  it('closeAll closes a live shard and reports it', async () => {
    const built = buildManager(gateway);
    manager = built.manager;
    await manager.connect();
    const socket = must(gateway.sockets[0], 'socket');

    await expect(built.strategy.closeAll()).resolves.toBe(1);
    expect(socket.readyState).not.toBe(WebSocket.OPEN);
  });
});

import { createServer, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { MultiplayerWorld } from "./multiplayer/world-engine.js";
import { WorldStore } from "./multiplayer/persistence.js";
import type { ServerOptions } from "./multiplayer/types.js";
import type { DeathCauseCategory, InheritanceEventRecord, LifeEventRecord } from "./life/types.js";
import { worldDescriptor } from "./world.js";
import { monitoring } from "./monitoring.js";

const MAX_MESSAGE_BYTES = 8 * 1024;

export interface ApiServer extends Server {
  shutdown(): Promise<void>;
  /** Internal server-owned lifecycle hook; it is deliberately not an HTTP/client command. */
  recordDeathEvent(characterId: string, cause: DeathCauseCategory): Promise<{
    event: LifeEventRecord;
    inheritanceEvent: InheritanceEventRecord | null;
    alreadyDeceased: boolean;
  }>;
  /** Internal server-owned retirement hook; it is deliberately not an HTTP/client command. */
  recordRetirementEvent(characterId: string): Promise<LifeEventRecord>;
}

export interface ApiServerOptions extends ServerOptions {
  readonly allowedOrigins?: readonly string[];
  readonly websocketPath?: string;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function rejectUpgrade(socket: NodeJS.Socket, statusCode: number, status: string): void {
  const body = `${status}\n`;
  socket.end(
    `HTTP/1.1 ${statusCode} ${status}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

/** Creates the existing read-only API plus one bounded, server-authoritative multiplayer world. */
export function createApiServer(options: ApiServerOptions = {}): ApiServer {
  const websocketPath = options.websocketPath ?? "/ws";
  const allowedOrigins = options.allowedOrigins ?? [];
  const stateFile = options.stateFile ?? fileURLToPath(new URL("../data/world-state.json", import.meta.url));
  const store = new WorldStore(stateFile, options.now?.() ?? Date.now());
  const world = new MultiplayerWorld(store, options);
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
  });

  const server = createServer(async (request, response) => {
    monitoring.recordRequest(false); // Track all requests
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    if (pathname === "/health") {
      const health = await monitoring.getHealthStatus();
      const statusCode = health.status === "unhealthy" ? 503 : 200;
      sendJson(response, statusCode, health);
      return;
    }

    if (pathname === "/metrics") {
      const metrics = monitoring.getMetrics();
      sendJson(response, 200, metrics);
      return;
    }

    if (pathname === "/api/v1/world") {
      sendJson(response, 200, worldDescriptor);
      return;
    }

    if (pathname === websocketPath) {
      sendJson(response, 426, { error: "websocket_upgrade_required" });
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  }) as ApiServer;

  server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (pathname !== websocketPath) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      rejectUpgrade(socket, 403, "Origin Not Allowed");
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (client, request) => {
    monitoring.recordConnection();
    monitoring.info("Client connected", { 
      ip: request.socket.remoteAddress,
      total_connections: monitoring.getMetrics().connections.total 
    });
    
    world.attach(client, request);
    client.on("pong", () => responsiveSockets.add(client));
    responsiveSockets.add(client);
    
    client.on("close", () => {
      monitoring.recordDisconnection();
      monitoring.info("Client disconnected");
    });
  });

  const responsiveSockets = new WeakSet<WebSocket>();
  const heartbeatTimer = setInterval(() => {
    for (const client of websocketServer.clients) {
      if (!responsiveSockets.has(client)) {
        client.terminate();
        continue;
      }
      responsiveSockets.delete(client);
      client.ping();
    }
  }, 15_000);
  heartbeatTimer.unref();

  const tickTimer = setInterval(() => {
    const tickStart = performance.now();
    world.tick();
    const tickDuration = performance.now() - tickStart;
    
    // Update world metrics
    const playersOnline = websocketServer.clients.size;
    const tickRate = 1000 / (options.tickIntervalMs ?? 50);
    monitoring.recordWorldMetrics(playersOnline, tickRate, tickDuration);
  }, options.tickIntervalMs ?? 50);
  tickTimer.unref();

  let shutdownPromise: Promise<void> | null = null;
  server.shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    clearInterval(heartbeatTimer);
    clearInterval(tickTimer);
    shutdownPromise = world.shutdown().then(
      () =>
        new Promise<void>((resolve, reject) => {
          websocketServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    return shutdownPromise;
  };
  server.on("close", () => {
    clearInterval(heartbeatTimer);
    clearInterval(tickTimer);
  });
  server.recordDeathEvent = (characterId, cause) => world.recordDeathEvent(characterId, cause);
  server.recordRetirementEvent = (characterId) => world.recordRetirementEvent(characterId);

  return server;
}

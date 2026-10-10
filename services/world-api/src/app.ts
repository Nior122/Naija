import { createServer, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { MultiplayerWorld, type IdentityBudgetOptions } from "./multiplayer/world-engine.js";
import { WorldStore, type WorldStoreLike } from "./multiplayer/persistence.js";
import type { ServerOptions } from "./multiplayer/types.js";
import type { DeathCauseCategory, InheritanceEventRecord, LifeEventRecord } from "./life/types.js";
import { worldDescriptor } from "./world.js";
import { monitoring, PROMETHEUS_CONTENT_TYPE, type HealthCheck } from "./monitoring.js";
import { decideMetricsAccess, type MetricsAccess } from "./metrics-access.js";
import { assertTestWorldFileIsolation } from "./runtime-environment.js";

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
  /** R4 identity-creation budget. Absent means no budget (the production entry point sets it from the environment). */
  readonly identityBudget?: IdentityBudgetOptions;
  readonly websocketPath?: string;
  /** Pre-opened world store (for example PostgreSQL). Defaults to the JSON file store at stateFile. */
  readonly worldStore?: WorldStoreLike;
  /** Persistence health reported under /health. Failing checks make the server unhealthy. */
  readonly persistenceHealth?: () => Promise<HealthCheck>;
  /**
   * Access policy for /metrics and /metrics/prometheus. Defaults to open for library and test use.
   * The entry point (index.ts) always passes the policy from the environment; production refuses "open".
   */
  readonly metricsAccess?: MetricsAccess;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (statusCode >= 500) monitoring.recordError();
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
  const metricsAccess: MetricsAccess = options.metricsAccess ?? { mode: "open" };
  const allowedOrigins = options.allowedOrigins ?? [];
  if (options.worldStore === undefined) {
    assertTestWorldFileIsolation(options.stateFile);
  }
  const stateFile = options.stateFile ?? fileURLToPath(new URL("../data/world-state.json", import.meta.url));
  const store: WorldStoreLike = options.worldStore ?? new WorldStore(stateFile, options.now?.() ?? Date.now());
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
      const extra: Record<string, HealthCheck> = {};
      if (options.persistenceHealth) {
        extra.persistence = await options.persistenceHealth().catch(
          (): HealthCheck => ({ status: "fail", message: "Persistence health check failed." }),
        );
      }
      const health = await monitoring.getHealthStatus(extra);
      const statusCode = health.status === "unhealthy" ? 503 : 200;
      sendJson(response, statusCode, health);
      return;
    }

    if (pathname === "/metrics" || pathname === "/metrics/prometheus") {
      const decision = decideMetricsAccess(metricsAccess, request.headers.authorization);
      if (decision === "not_found") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (decision === "unauthorized") {
        response.setHeader("WWW-Authenticate", 'Bearer realm="naija-metrics"');
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
    }

    if (pathname === "/metrics") {
      const metrics = monitoring.getMetrics();
      sendJson(response, 200, metrics);
      return;
    }

    if (pathname === "/metrics/prometheus") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": PROMETHEUS_CONTENT_TYPE,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(monitoring.getPrometheusMetrics());
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

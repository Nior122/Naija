import { createServer, type Server, type ServerResponse } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { MultiplayerWorld, type IdentityBudgetOptions } from "./multiplayer/world-engine.js";
import { WorldStore, type WorldStoreLike } from "./multiplayer/persistence.js";
import type { ServerOptions } from "./multiplayer/types.js";
import type { DeathCauseCategory, InheritanceEventRecord, LifeEventRecord } from "./life/types.js";
import { worldDescriptor } from "./world.js";
import { monitoring, PROMETHEUS_CONTENT_TYPE, type HealthCheck } from "./monitoring.js";
import { decideMetricsAccess, type MetricsAccess } from "./metrics-access.js";
import { parseTrustedProxies, resolveClientAddress, type TrustedProxies } from "./client-address.js";
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
  /**
   * Heartbeat period in milliseconds. Absent means 15 000 (the production value). Tests may shorten it; the entry point
   * does not set it, so production behaviour is unchanged.
   */
  readonly heartbeatIntervalMs?: number;
  /** Pre-opened world store (for example PostgreSQL). Defaults to the JSON file store at stateFile. */
  readonly worldStore?: WorldStoreLike;
  /** Persistence health reported under /health. Failing checks make the server unhealthy. */
  readonly persistenceHealth?: () => Promise<HealthCheck>;
  /**
   * Access policy for /metrics and /metrics/prometheus. Defaults to open for library and test use.
   * The entry point (index.ts) always passes the policy from the environment; production refuses "open".
   */
  readonly metricsAccess?: MetricsAccess;
  /**
   * Proxies whose X-Forwarded-For header is trusted (NAIJA_TRUSTED_PROXIES). The default trusts none, so the socket
   * address is always used. See client-address.ts.
   */
  readonly trustedProxies?: TrustedProxies;
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
  const trustedProxies = options.trustedProxies ?? parseTrustedProxies(undefined);
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

    // Liveness: the process is running and answering HTTP. It does not check persistence, so a failing save never
    // makes this endpoint fail. Use /health (readiness) to decide whether the instance should receive players. This
    // endpoint performs no reads or writes of world state.
    if (pathname === "/live") {
      sendJson(response, 200, { status: "alive", uptime: Math.round(process.uptime()) });
      return;
    }

    // Readiness: includes persistence health (the store's latest save outcome, fencing, and database reachability).
    // The check only reads state. It never saves, retries, or changes world state.
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
    
    const clientAddress = resolveClientAddress(request.socket.remoteAddress, request.headers["x-forwarded-for"], trustedProxies);
    world.attach(client, request, clientAddress);
    client.on("pong", () => responsiveSockets.add(client));
    responsiveSockets.add(client);
    
    client.on("close", () => {
      monitoring.recordDisconnection();
      monitoring.info("Client disconnected");
    });
  });

  const responsiveSockets = new WeakSet<WebSocket>();
  // Stage 38 diagnostics (R5). These record counts, times, and byte counts only: no addresses, player IDs, or tokens.
  // They do not change when a socket is terminated, and they add no timeout.
  const connectedAt = new WeakMap<WebSocket, number>();
  const pingSentAt = new WeakMap<WebSocket, number>();
  const LARGE_QUEUE_BYTES = 1024 * 1024;
  const LOOP_BLOCK_MS = 1000;
  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  websocketServer.on("connection", (client) => connectedAt.set(client, performance.now()));
  const heartbeatTimer = setInterval(() => {
    const loopMaxMs = loopDelay.max / 1e6;
    loopDelay.reset();
    if (loopMaxMs > LOOP_BLOCK_MS) {
      monitoring.warn("event loop was blocked during a heartbeat interval", { max_block_ms: Math.round(loopMaxMs) });
    }
    for (const client of websocketServer.clients) {
      if (!responsiveSockets.has(client)) {
        // No pong arrived after the previous ping. A new connection counts as responsive, so the first tick only pings it.
        monitoring.warn("heartbeat terminated a connection that did not answer its ping", {
          queued_bytes: client.bufferedAmount,
          ping_wait_ms: Math.round(performance.now() - (pingSentAt.get(client) ?? performance.now())),
          connection_age_ms: Math.round(performance.now() - (connectedAt.get(client) ?? performance.now())),
        });
        client.terminate();
        continue;
      }
      if (client.bufferedAmount > LARGE_QUEUE_BYTES) {
        monitoring.warn("a connection has a large outbound queue", { queued_bytes: client.bufferedAmount });
      }
      responsiveSockets.delete(client);
      pingSentAt.set(client, performance.now());
      client.ping();
    }
  }, options.heartbeatIntervalMs ?? 15_000);
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
    loopDelay.disable();
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
    loopDelay.disable();
  });
  server.recordDeathEvent = (characterId, cause) => world.recordDeathEvent(characterId, cause);
  server.recordRetirementEvent = (characterId) => world.recordRetirementEvent(characterId);

  return server;
}

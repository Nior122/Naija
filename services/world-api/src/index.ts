import { createApiServer } from "./app.js";
import { readApiConfig } from "./config.js";
import { openWorldPersistence } from "./persistence/open.js";

async function main(): Promise<void> {
  // Startup policy: configuration is validated first. Any failure stops the process before it listens.
  let config;
  try {
    config = readApiConfig();
  } catch (error) {
    console.error(`Naija world API cannot start: ${error instanceof Error ? error.message : "configuration is invalid."}`);
    process.exitCode = 1;
    return;
  }
  const { port, dataFile, websocketPath, allowedOrigins, gameMinuteMs, environment, metricsAccess } = config;

  // A configured PostgreSQL backend that cannot be opened stops the process here. There is no file fallback.
  let persistence;
  try {
    persistence = await openWorldPersistence({ stateFile: dataFile });
  } catch (error) {
    console.error(`Naija world API cannot start: ${error instanceof Error ? error.message : "persistence failed to open."}`);
    process.exitCode = 1;
    return;
  }

  const server = createApiServer({
    stateFile: dataFile,
    websocketPath,
    allowedOrigins,
    worldStore: persistence.store,
    persistenceHealth: () => persistence.health(),
    metricsAccess,
    ...(gameMinuteMs === undefined ? {} : { gameMinuteMs }),
  });

  server.listen(port, "0.0.0.0", () => {
    console.info(`Naija world API listening on 0.0.0.0:${port}`);
    console.info(`Environment: ${environment}`);
    console.info(`Multiplayer WebSocket path: ${websocketPath}`);
    console.info(`Persistence backend: ${persistence.backend}`);
    if (metricsAccess.mode === "ingress") {
      console.warn(
        "[Metrics] NAIJA_METRICS_ACCESS=ingress: the application does not check access to /metrics. Confirm that the ingress blocks /metrics and /metrics/prometheus from the public internet.",
      );
    } else {
      console.info(`[Metrics] access mode: ${metricsAccess.mode}`);
    }
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}; saving multiplayer world state.`);
    const httpClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
    void server
      .shutdown()
      .then(() => httpClosed)
      .then(() => persistence.close())
      .then(() => {
        console.info("Multiplayer world state saved; API stopped.");
      })
      .catch((error: unknown) => {
        console.error("API shutdown failed", error);
        process.exitCode = 1;
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main();

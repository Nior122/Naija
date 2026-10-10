import { createApiServer } from "./app.js";
import { readApiConfig } from "./config.js";
import { openWorldPersistence } from "./persistence/open.js";

async function main(): Promise<void> {
  const { port, dataFile, websocketPath, allowedOrigins, gameMinuteMs } = readApiConfig();

  // Startup policy: a configured PostgreSQL backend that cannot be opened stops the process here.
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
    ...(gameMinuteMs === undefined ? {} : { gameMinuteMs }),
  });

  server.listen(port, "0.0.0.0", () => {
    console.info(`Naija world API listening on 0.0.0.0:${port}`);
    console.info(`Multiplayer WebSocket path: ${websocketPath}`);
    console.info(`Persistence backend: ${persistence.backend}`);
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

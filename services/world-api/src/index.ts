import { createApiServer } from "./app.js";
import { readApiConfig } from "./config.js";

const { port, dataFile, websocketPath, allowedOrigins } = readApiConfig();
const server = createApiServer({
  stateFile: dataFile,
  websocketPath,
  allowedOrigins,
});

server.listen(port, "0.0.0.0", () => {
  console.info(`Naija world API listening on 0.0.0.0:${port}`);
  console.info(`Multiplayer WebSocket path: ${websocketPath}`);
  console.info(`World state file: ${dataFile}`);
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

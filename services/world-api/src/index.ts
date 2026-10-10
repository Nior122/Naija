import { createApiServer } from "./app.js";
import { readApiConfig } from "./config.js";
import { openWorldPersistence } from "./persistence/open.js";
import { monitoring } from "./monitoring.js";

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
  const { port, dataFile, websocketPath, allowedOrigins, gameMinuteMs, environment, metricsAccess, identityBudget } = config;
  const worldStateFormat = config.worldStateFormat;
  const trustedProxies = config.trustedProxies;
  monitoring.configureWorldStateWarnings(config.worldStateWarnPercent);

  // A configured PostgreSQL backend that cannot be opened stops the process here. There is no file fallback.
  let persistence;
  try {
    persistence = await openWorldPersistence({ stateFile: dataFile, fileFormat: worldStateFormat });
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
    ...(identityBudget === undefined ? {} : { identityBudget }),
    trustedProxies,
    ...(gameMinuteMs === undefined ? {} : { gameMinuteMs }),
  });

  server.listen(port, "0.0.0.0", () => {
    console.info(`Naija world API listening on 0.0.0.0:${port}`);
    console.info(`Environment: ${environment}`);
    console.info(trustedProxies.entries === 0
      ? "Trusted proxies: none (X-Forwarded-For is ignored; the socket address is used)."
      : `Trusted proxies: ${trustedProxies.entries} configured entr${trustedProxies.entries === 1 ? "y" : "ies"}; X-Forwarded-For is read only from a socket address on this list.`);
    console.info(`Multiplayer WebSocket path: ${websocketPath}`);
    console.info(`Persistence backend: ${persistence.backend}`);
    if (persistence.backend === "file") {
      console.info(`World state file format: ${worldStateFormat} (compact is opt-in; see docs/STAGE_28_COMPACT_JSON_ROLLOUT.md).`);
    }
    if (identityBudget === undefined) {
      console.info("Identity creation budget: disabled (NAIJA_IDENTITY_BUDGET is not 'enabled').");
    } else {
      console.info(
        `Identity creation budget: enabled, ${identityBudget.perIpLimit} new identities per IP and ${identityBudget.globalLimit} in total per ${identityBudget.windowMs / 60_000} minutes.`,
      );
    }
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

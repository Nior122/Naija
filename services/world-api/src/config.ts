import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// The API workspace lives at services/world-api; keep local-only config at the repository root.
const localEnvFile = new URL("../../../.env", import.meta.url);
if (existsSync(localEnvFile)) {
  loadEnvFile(localEnvFile);
}

export interface ApiConfig {
  readonly port: number;
}

export function readApiConfig(): ApiConfig {
  const rawPort = process.env.PORT ?? "3000";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return { port };
}

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// The API workspace lives at services/world-api; keep local-only config at the repository root.
const localEnvFile = new URL("../../../.env", import.meta.url);
if (existsSync(localEnvFile)) {
  loadEnvFile(localEnvFile);
}

const DEFAULT_DATA_FILE = fileURLToPath(new URL("../data/world-state.json", import.meta.url));

export interface ApiConfig {
  readonly port: number;
  readonly dataFile: string;
  readonly websocketPath: string;
  readonly allowedOrigins: readonly string[];
  readonly gameMinuteMs?: number;
}

export function readApiConfig(): ApiConfig {
  const rawPort = process.env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const rawWebsocketPath = process.env.WS_PATH ?? "/ws";
  if (!rawWebsocketPath.startsWith("/") || rawWebsocketPath.includes("?")) {
    throw new Error("WS_PATH must be a URL path beginning with '/'.");
  }
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  for (const origin of allowedOrigins) {
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) {
        throw new Error();
      }
    } catch {
      throw new Error("ALLOWED_ORIGINS must be a comma-separated list of HTTP(S) origins.");
    }
  }

  const dataFile = process.env.DATA_FILE
    ? resolve(process.cwd(), process.env.DATA_FILE)
    : DEFAULT_DATA_FILE;
  const rawGameMinuteMs = process.env.GAME_MINUTE_MS;
  let gameMinuteMs: number | undefined;
  if (rawGameMinuteMs !== undefined) {
    gameMinuteMs = Number(rawGameMinuteMs);
    if (!Number.isSafeInteger(gameMinuteMs) || gameMinuteMs < 1 || gameMinuteMs > 60_000) {
      throw new Error("GAME_MINUTE_MS must be an integer between 1 and 60000.");
    }
  }
  return {
    port,
    dataFile,
    websocketPath: rawWebsocketPath,
    allowedOrigins,
    ...(gameMinuteMs === undefined ? {} : { gameMinuteMs }),
  };
}

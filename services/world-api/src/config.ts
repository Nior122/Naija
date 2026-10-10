import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseMetricsAccess, type MetricsAccess } from "./metrics-access.js";
import { readRuntimeEnvironment, type RuntimeEnvironment } from "./runtime-environment.js";

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
  readonly environment: RuntimeEnvironment;
  readonly metricsAccess: MetricsAccess;
  /** Usage percentages of the world-state size limit that log a warning (strictly ascending). */
  readonly worldStateWarnPercent: readonly number[];
}

/**
 * WORLD_STATE_WARN_PERCENT: comma-separated integers from 1 to 99, strictly ascending. Default "75,90".
 * Invalid values stop startup; the value is not echoed back.
 */
export function parseWorldStateWarnPercent(env: NodeJS.ProcessEnv): readonly number[] {
  const raw = env.WORLD_STATE_WARN_PERCENT;
  if (raw === undefined || raw.trim() === "") return [75, 90];
  const parts = raw.split(",").map((part) => part.trim());
  const values = parts.map((part) => (/^\d{1,2}$/.test(part) ? Number(part) : Number.NaN));
  const valid = values.every((value) => Number.isInteger(value) && value >= 1 && value <= 99) &&
    values.every((value, index) => index === 0 || value > (values[index - 1] ?? 0));
  if (!valid) throw new Error("WORLD_STATE_WARN_PERCENT must be strictly ascending integers from 1 to 99, for example 75,90.");
  return values;
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const environment = readRuntimeEnvironment(env, { required: true }) as RuntimeEnvironment;
  const metricsAccess = parseMetricsAccess(env, environment);
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const rawWebsocketPath = env.WS_PATH ?? "/ws";
  if (!rawWebsocketPath.startsWith("/") || rawWebsocketPath.includes("?")) {
    throw new Error("WS_PATH must be a URL path beginning with '/'.");
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
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

  const dataFile = env.DATA_FILE
    ? resolve(process.cwd(), env.DATA_FILE)
    : DEFAULT_DATA_FILE;
  const rawGameMinuteMs = env.GAME_MINUTE_MS;
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
    environment,
    metricsAccess,
    worldStateWarnPercent: parseWorldStateWarnPercent(env),
  };
}

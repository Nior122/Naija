import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseMetricsAccess, type MetricsAccess } from "./metrics-access.js";
import { readRuntimeEnvironment, type RuntimeEnvironment } from "./runtime-environment.js";
import type { IdentityBudgetOptions } from "./multiplayer/world-engine.js";

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
  /** R4 identity-creation budget. Undefined unless NAIJA_IDENTITY_BUDGET=enabled. */
  readonly identityBudget: IdentityBudgetOptions | undefined;
}

const IDENTITY_BUDGET_DEFAULTS = { perIp: 10, global: 100, windowMinutes: 60 } as const;

function parseBoundedInteger(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    // The value is not echoed back, so a secret or a typo is not written to logs.
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

/**
 * R4 identity-creation budget. NAIJA_IDENTITY_BUDGET: "enabled" or "disabled" (default disabled, so nothing is enforced
 * until an operator turns it on). When enabled, NAIJA_IDENTITY_LIMIT_PER_IP (default 10), NAIJA_IDENTITY_LIMIT_GLOBAL
 * (default 100) and NAIJA_IDENTITY_WINDOW_MINUTES (default 60) apply. Limits are validated even when disabled.
 */
export function parseIdentityBudget(env: NodeJS.ProcessEnv): IdentityBudgetOptions | undefined {
  const perIpLimit = parseBoundedInteger(env.NAIJA_IDENTITY_LIMIT_PER_IP, IDENTITY_BUDGET_DEFAULTS.perIp, 1, 1000, "NAIJA_IDENTITY_LIMIT_PER_IP");
  const globalLimit = parseBoundedInteger(env.NAIJA_IDENTITY_LIMIT_GLOBAL, IDENTITY_BUDGET_DEFAULTS.global, 1, 100_000, "NAIJA_IDENTITY_LIMIT_GLOBAL");
  const windowMinutes = parseBoundedInteger(env.NAIJA_IDENTITY_WINDOW_MINUTES, IDENTITY_BUDGET_DEFAULTS.windowMinutes, 1, 1440, "NAIJA_IDENTITY_WINDOW_MINUTES");
  const mode = (env.NAIJA_IDENTITY_BUDGET ?? "disabled").trim();
  if (mode !== "enabled" && mode !== "disabled") {
    throw new Error("NAIJA_IDENTITY_BUDGET must be 'enabled' or 'disabled'.");
  }
  if (mode === "disabled") return undefined;
  return { perIpLimit, globalLimit, windowMs: windowMinutes * 60_000 };
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
    identityBudget: parseIdentityBudget(env),
  };
}

import { createHash, timingSafeEqual } from "node:crypto";
import { effectiveEnvironment, type RuntimeEnvironment } from "./runtime-environment.js";

/**
 * Access policy for the metrics endpoints (/metrics and /metrics/prometheus). Stage 28.
 *
 * NAIJA_METRICS_ACCESS:
 * - "token": requests need "Authorization: Bearer <NAIJA_METRICS_TOKEN>". The token is compared as SHA-256
 *   digests in constant time. It is never logged or echoed.
 * - "ingress": the application does NOT check access. The deployment must block these paths from the public
 *   internet. This is an operator declaration, not something the application can verify.
 * - "disabled": both paths return 404.
 * - "open": no check. Development and test only.
 *
 * Production must set one of token, ingress, or disabled. An unset value is refused in production.
 * /health is not covered by this policy: load balancers need it, and it does not expose the metric counters.
 */

export const METRICS_TOKEN_MIN_LENGTH = 32;

export type MetricsAccess =
  | { readonly mode: "open" }
  | { readonly mode: "ingress" }
  | { readonly mode: "disabled" }
  | { readonly mode: "token"; readonly tokenDigest: Buffer };

export type MetricsDecision = "allowed" | "unauthorized" | "not_found";

const OPEN: MetricsAccess = { mode: "open" };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Reads the policy. Error messages name the variables and rules; they never include the token.
 */
export function parseMetricsAccess(env: NodeJS.ProcessEnv, environment: RuntimeEnvironment | undefined): MetricsAccess {
  const effective = effectiveEnvironment(environment);
  const raw = env.NAIJA_METRICS_ACCESS?.trim().toLowerCase();
  const token = env.NAIJA_METRICS_TOKEN;
  const tokenSet = token !== undefined && token !== "";

  if (raw === undefined || raw === "") {
    if (effective === "production") {
      throw new Error("NAIJA_METRICS_ACCESS is required in production: token, ingress, or disabled.");
    }
    if (tokenSet) {
      throw new Error("NAIJA_METRICS_TOKEN is set but NAIJA_METRICS_ACCESS is not token.");
    }
    return OPEN;
  }

  if (raw === "open") {
    if (effective === "production") {
      throw new Error("NAIJA_METRICS_ACCESS=open is not allowed in production.");
    }
    if (tokenSet) {
      throw new Error("NAIJA_METRICS_TOKEN is set but NAIJA_METRICS_ACCESS is not token.");
    }
    return OPEN;
  }

  if (raw === "disabled" || raw === "ingress") {
    if (tokenSet) {
      throw new Error(`NAIJA_METRICS_TOKEN is set but NAIJA_METRICS_ACCESS is ${raw}. Remove the token or use token mode.`);
    }
    return { mode: raw };
  }

  if (raw === "token") {
    if (!tokenSet) {
      throw new Error("NAIJA_METRICS_TOKEN is required when NAIJA_METRICS_ACCESS=token.");
    }
    if (token.length < METRICS_TOKEN_MIN_LENGTH || /\s/.test(token)) {
      throw new Error(
        `NAIJA_METRICS_TOKEN must be at least ${METRICS_TOKEN_MIN_LENGTH} characters with no whitespace.`,
      );
    }
    return { mode: "token", tokenDigest: digest(token) };
  }

  throw new Error("NAIJA_METRICS_ACCESS must be token, ingress, disabled, or open (open is development and test only).");
}

/** Decides one request from its Authorization header. Constant-time comparison; no value is logged. */
export function decideMetricsAccess(access: MetricsAccess, authorization: string | undefined): MetricsDecision {
  if (access.mode === "disabled") {
    return "not_found";
  }
  if (access.mode !== "token") {
    return "allowed";
  }
  const match = authorization === undefined ? null : /^Bearer\s+(\S+)$/i.exec(authorization);
  if (match === null || match[1] === undefined) {
    return "unauthorized";
  }
  const candidate = digest(match[1]);
  return timingSafeEqual(candidate, access.tokenDigest) ? "allowed" : "unauthorized";
}

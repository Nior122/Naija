import { monitorEventLoopDelay, performance, type IntervalHistogram } from "node:perf_hooks";

/**
 * Lightweight monitoring and metrics collection for Naija: One World
 * Provides health checks, metrics, and observability without external dependencies
 */

/** Content type required by the Prometheus text exposition format, version 0.0.4. */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  timestamp: number;
  checks: Record<string, HealthCheck>;
  metrics: ServerMetrics;
}

export interface HealthCheck {
  status: "pass" | "fail" | "warn";
  message?: string;
  duration_ms?: number;
}

export interface ServerMetrics {
  persistence: {
    flushes: number;
    flush_failures: number;
    last_flush_duration_ms: number;
  };
  connections: {
    active: number;
    total: number;
    peak: number;
  };
  requests: {
    total: number;
    errors: number;
    rate_per_second: number;
  };
  memory: {
    rss_mb: number;
    heap_used_mb: number;
    heap_total_mb: number;
  };
  performance: {
    event_loop_delay_ms: number;
    cpu_percent: number;
  };
  world: {
    players_online: number;
    tick_rate: number;
    last_tick_duration_ms: number;
    /** Size of the most recent successful world-state save, in bytes (0 before the first save). */
    state_bytes_last_saved: number;
    /** The fixed size limit for one saved world, in bytes. */
    state_limit_bytes: number;
    /** state_bytes_last_saved / state_limit_bytes. */
    state_usage_ratio: number;
    /** Player records in the most recent successful save. */
    persisted_players: number;
  };
}

export class MonitoringService {
  private startTime: number;
  private version: string;
  private activeConnections: number = 0;
  private totalConnections: number = 0;
  private peakConnections: number = 0;
  private totalRequests: number = 0;
  private errorCount: number = 0;
  private requestStartTime: number = 0;
  private lastTickDuration: number = 0;
  private playersOnline: number = 0;
  private stateBytesLastSaved = 0;
  private stateLimitBytes = 0;
  private persistedPlayers = 0;
  private warnPercentages: readonly number[] = [75, 90];
  private highestWarnedPercent = 0;
  private tickRate: number = 0;
  private flushes: number = 0;
  private flushFailures: number = 0;
  private lastFlushDurationMs: number = 0;
  private readonly loopDelay: IntervalHistogram;
  private cpuBaseline: { usage: NodeJS.CpuUsage; at: number };

  constructor(version: string = "1.0.0") {
    this.startTime = Date.now();
    this.version = version;
    this.requestStartTime = Date.now();
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
    this.cpuBaseline = { usage: process.cpuUsage(), at: performance.now() };
  }

  /**
   * Stop background sampling. The global instance lives for the process lifetime;
   * tests that create their own instances should call this.
   */
  dispose(): void {
    this.loopDelay.disable();
  }

  /**
   * Record one world-state save attempt. Durations are measured around the write itself.
   */
  recordPersistenceFlush(succeeded: boolean, durationMs: number): void {
    this.flushes++;
    if (!succeeded) this.flushFailures++;
    this.lastFlushDurationMs = Math.round(durationMs * 100) / 100;
  }

  /**
   * Record a successful world-state save: its size against the limit, and the player count. Logs a
   * warning when usage first crosses a configured percentage (once per level, no record contents).
   */
  recordWorldStateSaved(bytes: number, players: number, limitBytes: number): void {
    this.stateBytesLastSaved = bytes;
    this.stateLimitBytes = limitBytes;
    this.persistedPlayers = players;
    const percent = limitBytes > 0 ? (bytes / limitBytes) * 100 : 0;
    const crossed = this.warnPercentages.filter((level) => percent >= level && level > this.highestWarnedPercent);
    if (crossed.length > 0) {
      const level = Math.max(...crossed);
      this.highestWarnedPercent = level;
      console.warn(
        `world state is at ${percent.toFixed(1)}% of its size limit (warning threshold ${level}%); players persisted: ${players}`,
      );
    }
  }

  /**
   * Set the usage percentages that trigger a warning log. Values must be integers from 1 to 99,
   * strictly ascending. The defaults are 75 and 90.
   */
  configureWorldStateWarnings(percentages: readonly number[]): void {
    const valid = percentages.every((value) => Number.isInteger(value) && value >= 1 && value <= 99) &&
      percentages.every((value, index) => index === 0 || value > (percentages[index - 1] ?? 0));
    if (!valid) throw new Error("World state warning percentages must be strictly ascending integers from 1 to 99.");
    this.warnPercentages = [...percentages];
    this.highestWarnedPercent = 0;
  }

  /**
   * Record a server-side failure (HTTP 5xx). Client errors are not counted here.
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Record a new client connection
   */
  recordConnection(): void {
    this.activeConnections++;
    this.totalConnections++;
    if (this.activeConnections > this.peakConnections) {
      this.peakConnections = this.activeConnections;
    }
  }

  /**
   * Record a client disconnection
   */
  recordDisconnection(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Record an HTTP request
   */
  recordRequest(isError: boolean = false): void {
    this.totalRequests++;
    if (isError) {
      this.errorCount++;
    }
  }

  /**
   * Update world simulation metrics
   */
  recordWorldMetrics(playersOnline: number, tickRate: number, tickDuration: number): void {
    this.playersOnline = playersOnline;
    this.tickRate = tickRate;
    this.lastTickDuration = tickDuration;
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(extraChecks: Record<string, HealthCheck> = {}): Promise<HealthStatus> {
    const checks: Record<string, HealthCheck> = {};
    
    // Check memory usage
    const memCheck = await this.checkMemory();
    checks.memory = memCheck;

    // Check event loop
    const eventLoopCheck = await this.checkEventLoop();
    checks.event_loop = eventLoopCheck;

    // Check connections
    const connectionCheck = this.checkConnections();
    checks.connections = connectionCheck;

    // Caller-supplied checks (for example persistence reachability) join the overall status.
    Object.assign(checks, extraChecks);

    // Determine overall status
    const hasFailure = Object.values(checks).some(c => c.status === "fail");
    const hasWarning = Object.values(checks).some(c => c.status === "warn");
    
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (hasFailure) status = "unhealthy";
    else if (hasWarning) status = "degraded";

    return {
      status,
      version: this.version,
      uptime: Date.now() - this.startTime,
      timestamp: Date.now(),
      checks,
      metrics: this.getMetrics(),
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): ServerMetrics {
    const memUsage = process.memoryUsage();
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    const requestRate = this.totalRequests / Math.max(1, uptimeSeconds);

    // Event-loop delay: p99 over the window since the previous sample (nanoseconds -> ms).
    const eventLoopDelayMs = this.loopDelay.count > 0 ? this.loopDelay.percentile(99) / 1e6 : 0;
    this.loopDelay.reset();

    // CPU: user+system time used since the previous sample, as a percent of one core.
    const now = performance.now();
    const cpuNow = process.cpuUsage(this.cpuBaseline.usage);
    const wallMicros = Math.max(1, (now - this.cpuBaseline.at) * 1000);
    const cpuPercent = ((cpuNow.user + cpuNow.system) / wallMicros) * 100;
    this.cpuBaseline = { usage: process.cpuUsage(), at: now };

    return {
      persistence: {
        flushes: this.flushes,
        flush_failures: this.flushFailures,
        last_flush_duration_ms: this.lastFlushDurationMs,
      },
      connections: {
        active: this.activeConnections,
        total: this.totalConnections,
        peak: this.peakConnections,
      },
      requests: {
        total: this.totalRequests,
        errors: this.errorCount,
        rate_per_second: Math.round(requestRate * 100) / 100,
      },
      memory: {
        rss_mb: Math.round(memUsage.rss / 1024 / 1024),
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      performance: {
        event_loop_delay_ms: Math.round(eventLoopDelayMs * 100) / 100,
        cpu_percent: Math.round(cpuPercent * 100) / 100,
      },
      world: {
        players_online: this.playersOnline,
        tick_rate: this.tickRate,
        last_tick_duration_ms: this.lastTickDuration,
        state_bytes_last_saved: this.stateBytesLastSaved,
        state_limit_bytes: this.stateLimitBytes,
        state_usage_ratio: this.stateLimitBytes > 0 ? Math.round((this.stateBytesLastSaved / this.stateLimitBytes) * 10000) / 10000 : 0,
        persisted_players: this.persistedPlayers,
      },
    };
  }

  /**
   * Render metrics in the Prometheus text exposition format (served at /metrics/prometheus).
   * Note: calling this samples event-loop and CPU usage, like getMetrics().
   */
  getPrometheusMetrics(): string {
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    return renderPrometheusMetrics(this.getMetrics(), uptimeSeconds);
  }

  /**
   * Check memory health
   */
  private async checkMemory(): Promise<HealthCheck> {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const heapPercent = (heapUsedMB / heapTotalMB) * 100;

    if (heapPercent > 90) {
      return {
        status: "fail",
        message: `Heap usage critical: ${heapPercent.toFixed(1)}%`,
      };
    } else if (heapPercent > 75) {
      return {
        status: "warn",
        message: `Heap usage high: ${heapPercent.toFixed(1)}%`,
      };
    }

    return {
      status: "pass",
      message: `Heap usage normal: ${heapPercent.toFixed(1)}%`,
    };
  }

  /**
   * Check event loop health
   */
  private async checkEventLoop(): Promise<HealthCheck> {
    const start = performance.now();
    await new Promise(resolve => setImmediate(resolve));
    const delay = performance.now() - start;

    if (delay > 100) {
      return {
        status: "fail",
        message: `Event loop delay critical: ${delay.toFixed(2)}ms`,
        duration_ms: delay,
      };
    } else if (delay > 50) {
      return {
        status: "warn",
        message: `Event loop delay high: ${delay.toFixed(2)}ms`,
        duration_ms: delay,
      };
    }

    return {
      status: "pass",
      message: `Event loop delay normal: ${delay.toFixed(2)}ms`,
      duration_ms: delay,
    };
  }

  /**
   * Check connection health
   */
  private checkConnections(): HealthCheck {
    if (this.activeConnections === 0 && this.totalConnections > 0) {
      return {
        status: "warn",
        message: "No active connections",
      };
    }

    return {
      status: "pass",
      message: `${this.activeConnections} active connections`,
    };
  }

  /**
   * Get structured log entry
   */
  getLogEntry(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): string {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: "world-api",
      version: this.version,
      ...data,
    };
    return JSON.stringify(entry);
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    console.log(this.getLogEntry("info", message, data));
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(this.getLogEntry("warn", message, data));
  }

  /**
   * Log error message
   */
  error(message: string, data?: Record<string, unknown>): void {
    console.error(this.getLogEntry("error", message, data));
  }
}

interface PrometheusMetricDefinition {
  name: string;
  help: string;
  type: "gauge" | "counter";
  value: number;
}

/**
 * Pure renderer for the Prometheus text format. Exported for tests.
 * Metric names follow Prometheus conventions (snake_case, unit suffix, _total for counters).
 */
export function renderPrometheusMetrics(metrics: ServerMetrics, uptimeSeconds: number): string {
  const definitions: PrometheusMetricDefinition[] = [
    { name: "naija_world_api_up", help: "1 while the world API process is serving metrics.", type: "gauge", value: 1 },
    { name: "naija_world_api_uptime_seconds", help: "Seconds since the monitoring service started.", type: "gauge", value: uptimeSeconds },
    { name: "naija_world_api_persistence_flushes_total", help: "World-state save attempts since start.", type: "counter", value: metrics.persistence.flushes },
    { name: "naija_world_api_persistence_flush_failures_total", help: "World-state save attempts that failed.", type: "counter", value: metrics.persistence.flush_failures },
    { name: "naija_world_api_persistence_last_flush_duration_milliseconds", help: "Duration of the most recent world-state save.", type: "gauge", value: metrics.persistence.last_flush_duration_ms },
    { name: "naija_world_api_connections_active", help: "Currently open multiplayer WebSocket connections.", type: "gauge", value: metrics.connections.active },
    { name: "naija_world_api_connections_peak", help: "Highest concurrent WebSocket connection count observed.", type: "gauge", value: metrics.connections.peak },
    { name: "naija_world_api_connections_total", help: "WebSocket connections accepted since start.", type: "counter", value: metrics.connections.total },
    { name: "naija_world_api_requests_total", help: "HTTP requests received since start.", type: "counter", value: metrics.requests.total },
    { name: "naija_world_api_request_errors_total", help: "HTTP responses with a 5xx status since start.", type: "counter", value: metrics.requests.errors },
    { name: "naija_world_api_memory_rss_megabytes", help: "Resident set size in mebibytes.", type: "gauge", value: metrics.memory.rss_mb },
    { name: "naija_world_api_memory_heap_used_megabytes", help: "V8 heap used in mebibytes.", type: "gauge", value: metrics.memory.heap_used_mb },
    { name: "naija_world_api_memory_heap_total_megabytes", help: "V8 heap total in mebibytes.", type: "gauge", value: metrics.memory.heap_total_mb },
    { name: "naija_world_api_event_loop_delay_p99_milliseconds", help: "p99 event-loop delay over the last sample window.", type: "gauge", value: metrics.performance.event_loop_delay_ms },
    { name: "naija_world_api_cpu_percent", help: "CPU use since the last sample, as a percent of one core.", type: "gauge", value: metrics.performance.cpu_percent },
    { name: "naija_world_api_players_online", help: "Players currently online in the multiplayer world.", type: "gauge", value: metrics.world.players_online },
    { name: "naija_world_api_world_state_bytes", help: "Size of the most recent successful world-state save, in bytes.", type: "gauge", value: metrics.world.state_bytes_last_saved },
    { name: "naija_world_api_world_state_limit_bytes", help: "Size limit for one saved world, in bytes.", type: "gauge", value: metrics.world.state_limit_bytes },
    { name: "naija_world_api_world_state_usage_ratio", help: "Most recent saved world size divided by the size limit.", type: "gauge", value: metrics.world.state_usage_ratio },
    { name: "naija_world_api_persisted_players", help: "Player records in the most recent successful save.", type: "gauge", value: metrics.world.persisted_players },
    { name: "naija_world_api_tick_rate", help: "Configured world simulation tick rate.", type: "gauge", value: metrics.world.tick_rate },
    { name: "naija_world_api_last_tick_duration_milliseconds", help: "Duration of the most recent world tick.", type: "gauge", value: metrics.world.last_tick_duration_ms },
  ];

  const lines: string[] = [];
  for (const metric of definitions) {
    const value = Number.isFinite(metric.value) ? metric.value : 0;
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    lines.push(`${metric.name} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

// Global monitoring instance
export const monitoring = new MonitoringService();

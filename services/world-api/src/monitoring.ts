import { performance } from "node:perf_hooks";

/**
 * Lightweight monitoring and metrics collection for Naija: One World
 * Provides health checks, metrics, and observability without external dependencies
 */

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
  private tickRate: number = 0;

  constructor(version: string = "1.0.0") {
    this.startTime = Date.now();
    this.version = version;
    this.requestStartTime = Date.now();
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
  async getHealthStatus(): Promise<HealthStatus> {
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

    return {
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
        event_loop_delay_ms: 0, // Would need async measurement
        cpu_percent: 0, // Would need process.cpuUsage() calculation
      },
      world: {
        players_online: this.playersOnline,
        tick_rate: this.tickRate,
        last_tick_duration_ms: this.lastTickDuration,
      },
    };
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
    const activePercent = (this.activeConnections / Math.max(1, this.peakConnections)) * 100;

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

// Global monitoring instance
export const monitoring = new MonitoringService();

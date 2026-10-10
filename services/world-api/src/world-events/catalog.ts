import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WorldEventCategory,
  WorldEventType,
  WorldEventPriority,
  WorldEventConsumer,
  WorldEventProcessingConfig,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WorldEventCatalog {
  readonly schema_version: number;
  readonly world_id: "nigeria-main";
  readonly notice: string;
  readonly rules: {
    readonly event_retention_days: number;
    readonly max_event_payload_size_kb: number;
    readonly max_causation_chain_depth: number;
    readonly max_retry_attempts: number;
    readonly retry_backoff_seconds: number;
    readonly retry_max_backoff_seconds: number;
    readonly batch_size: number;
    readonly processing_timeout_seconds: number;
    readonly dead_letter_queue_enabled: boolean;
    readonly idempotency_window_hours: number;
    readonly event_deduplication_enabled: boolean;
  };
  readonly event_priorities: Record<
    WorldEventPriority,
    {
      readonly description: string;
      readonly processing_delay_seconds: number;
      readonly retry_priority: string;
    }
  >;
  readonly event_categories: Record<
    WorldEventCategory,
    {
      readonly description: string;
      readonly requires_authorization: boolean;
      readonly authorization_level: string;
      readonly visibility_default: string;
      readonly allowed_source_types: readonly string[];
    }
  >;
  readonly consumer_configurations: readonly WorldEventConsumer[];
  readonly causal_chains: Record<
    string,
    {
      readonly description: string;
      readonly example_chain: readonly string[];
      readonly max_depth: number;
      readonly cooldown_hours: number;
    }
  >;
}

export class WorldEventCatalogService {
  private readonly catalog: WorldEventCatalog;

  constructor() {
    const catalogPath = join(__dirname, "../../../../game/data/world-events/catalog.json");
    const raw = readFileSync(catalogPath, "utf8");
    this.catalog = JSON.parse(raw) as WorldEventCatalog;
  }

  getRules(): WorldEventCatalog["rules"] {
    return this.catalog.rules;
  }

  getCategoryConfig(category: WorldEventCategory): WorldEventCatalog["event_categories"][WorldEventCategory] {
    return this.catalog.event_categories[category];
  }

  getPriorityConfig(priority: WorldEventPriority): WorldEventCatalog["event_priorities"][WorldEventPriority] {
    return this.catalog.event_priorities[priority];
  }

  getDefaultConsumers(): readonly WorldEventConsumer[] {
    return this.catalog.consumer_configurations;
  }

  getDefaultProcessingConfig(): WorldEventProcessingConfig {
    return {
      max_retry_attempts: this.catalog.rules.max_retry_attempts,
      retry_backoff_seconds: this.catalog.rules.retry_backoff_seconds,
      retry_max_backoff_seconds: this.catalog.rules.retry_max_backoff_seconds,
      batch_size: this.catalog.rules.batch_size,
      processing_timeout_seconds: this.catalog.rules.processing_timeout_seconds,
      dead_letter_queue_enabled: this.catalog.rules.dead_letter_queue_enabled,
    };
  }

  isValidCategory(category: string): category is WorldEventCategory {
    return category in this.catalog.event_categories;
  }

  isValidPriority(priority: string): priority is WorldEventPriority {
    return priority in this.catalog.event_priorities;
  }

  isSourceTypeAllowed(category: WorldEventCategory, sourceType: string): boolean {
    const config = this.getCategoryConfig(category);
    return config.allowed_source_types.includes(sourceType);
  }

  requiresAuthorization(category: WorldEventCategory): boolean {
    const config = this.getCategoryConfig(category);
    return config.requires_authorization;
  }

  getDefaultVisibility(category: WorldEventCategory): string {
    const config = this.getCategoryConfig(category);
    return config.visibility_default;
  }
}

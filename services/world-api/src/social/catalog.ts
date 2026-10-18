/**
 * Stage 18 — Social Network System
 * Loads and provides access to the social network catalogue.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SocialCatalog, SocialRules } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_FILE = "game/data/social/catalog.json";

function repositoryRoot(): string {
  return join(__dirname, "../../../..");
}

let cached: SocialCatalog | null = null;

export function loadSocialCatalog(): SocialCatalog {
  if (cached) return cached;
  const catalogPath = join(repositoryRoot(), CATALOG_FILE);
  const raw = readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(raw) as SocialCatalog;
  cached = parsed;
  return parsed;
}

export class SocialCatalogService {
  private catalog: SocialCatalog;

  constructor() {
    this.catalog = loadSocialCatalog();
  }

  get(): SocialCatalog { return this.catalog; }
  getRules(): SocialRules { return this.catalog.rules; }

  hasContentType(id: string): boolean {
    return this.catalog.content_types.some((c) => c.id === id);
  }

  hasVisibility(id: string): boolean {
    return this.catalog.visibility_types.some((v) => v.id === id);
  }

  hasReactionType(id: string): boolean {
    return this.catalog.reaction_types.some((r) => r.id === id);
  }

  hasNotificationType(id: string): boolean {
    return this.catalog.notification_types.some((n) => n.id === id);
  }

  hasReportCategory(id: string): boolean {
    return this.catalog.report_categories.some((c) => c.id === id);
  }

  hasReportStatus(id: string): boolean {
    return this.catalog.report_statuses.some((s) => s.id === id);
  }

  hasAdCampaignStatus(id: string): boolean {
    return this.catalog.ad_campaign_statuses.some((s) => s.id === id);
  }

  hasAccountStatus(id: string): boolean {
    return this.catalog.account_statuses.some((s) => s.id === id);
  }

  isValidUsername(username: string): boolean {
    const rules = this.catalog.rules;
    if (username.length < rules.username_min_length || username.length > rules.username_max_length) {
      return false;
    }
    const pattern = new RegExp(rules.username_pattern);
    return pattern.test(username);
  }
}

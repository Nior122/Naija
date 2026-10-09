import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coordinateIsWithinBounds, geographicToGamePosition, normalizeCoordinate } from "./coordinates.js";
import { createGeographicLocation } from "./importer.js";
import type { GeographicCoordinate, GeographicLocation, GeographicRegion } from "./types.js";

const REGION_FILE = "game/data/geography/processed/akure-south-core.json";
const REGION_ID = "ng:region:ondo:akure-south-core";

function discoverRepositoryRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(candidate, REGION_FILE))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(
    `Could not locate ${REGION_FILE}; run npm run geography:import before starting the world API.`,
  );
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isCoordinate(value: unknown): value is GeographicCoordinate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const coordinate = value as Record<string, unknown>;
  return (
    typeof coordinate.latitude === "number" &&
    Number.isFinite(coordinate.latitude) &&
    typeof coordinate.longitude === "number" &&
    Number.isFinite(coordinate.longitude)
  );
}

function validateRegion(value: unknown): GeographicRegion {
  const region = asRecord(value, "Processed Akure South region");
  const viewport = asRecord(region.viewport, "Processed region viewport");
  const bounds = asRecord(viewport.bounds_wgs84, "Processed region viewport bounds");
  const frame = asRecord(region.frame, "Processed region frame");
  const origin = frame.origin;
  if (
    region.schema_version !== 1 ||
    region.world_id !== "nigeria-main" ||
    region.id !== REGION_ID ||
    !Number.isFinite(bounds.west) ||
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.east) ||
    !Number.isFinite(bounds.north) ||
    typeof viewport.width !== "number" ||
    typeof viewport.height !== "number" ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !isCoordinate(origin) ||
    !Array.isArray(region.wards) ||
    !Array.isArray(region.features) ||
    typeof region.state_id !== "string" ||
    typeof region.lga_id !== "string" ||
    typeof region.settlement_id !== "string"
  ) {
    throw new Error("Processed Akure South region failed runtime schema validation.");
  }
  const typed = region as unknown as GeographicRegion;
  for (const ward of typed.wards) {
    if (
      typeof ward.id !== "string" ||
      typeof ward.name !== "string" ||
      !isCoordinate(ward.coordinate)
    ) {
      throw new Error("Processed ward record failed runtime schema validation.");
    }
  }
  return typed;
}

let cachedRegion: GeographicRegion | null = null;

export function loadAkureSouthRegion(): GeographicRegion {
  if (cachedRegion !== null) return cachedRegion;
  const configuredDirectory = process.env.NAIJA_GEOGRAPHY_DATA_DIR;
  const filePath = configuredDirectory
    ? resolve(configuredDirectory, "akure-south-core.json")
    : join(discoverRepositoryRoot(), REGION_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not load processed geography at ${filePath}.`, { cause: error });
  }
  cachedRegion = validateRegion(parsed);
  return cachedRegion;
}

export function geographicLocationFromCoordinate(
  coordinate: GeographicCoordinate,
  region: GeographicRegion = loadAkureSouthRegion(),
): GeographicLocation {
  const normalized = normalizeCoordinate(coordinate);
  if (!coordinateIsWithinBounds(normalized, region.viewport.bounds_wgs84)) {
    throw new Error("Geographic location is outside the selected region viewport.");
  }
  return createGeographicLocation(region, normalized);
}

export function geographicLocationFromProfile(
  value: unknown,
  region: GeographicRegion = loadAkureSouthRegion(),
): GeographicLocation {
  const profile = asRecord(value, "Profile geographic_location");
  if (profile.region_id !== region.id || !isCoordinate(profile)) {
    throw new Error("invalid_geographic_location");
  }
  try {
    return geographicLocationFromCoordinate(profile, region);
  } catch {
    throw new Error("invalid_geographic_location");
  }
}

export function geographicLocationToMapPosition(
  location: GeographicLocation,
  region: GeographicRegion = loadAkureSouthRegion(),
): { x: number; y: number } {
  if (location.region_id !== region.id) throw new Error("Geographic location region does not match.");
  const coordinate = { latitude: location.latitude, longitude: location.longitude };
  const bounds = region.viewport.bounds_wgs84;
  if (!coordinateIsWithinBounds(coordinate, bounds)) throw new Error("Geographic location is outside the region.");
  return {
    x: ((coordinate.longitude - bounds.west) / (bounds.east - bounds.west)) * region.viewport.width,
    y: ((bounds.north - coordinate.latitude) / (bounds.north - bounds.south)) * region.viewport.height,
  };
}

export function geographicLocationForMapPosition(
  position: { readonly x: number; readonly y: number },
  region: GeographicRegion = loadAkureSouthRegion(),
): GeographicLocation {
  const x = Math.max(0, Math.min(region.viewport.width, position.x));
  const y = Math.max(0, Math.min(region.viewport.height, position.y));
  const bounds = region.viewport.bounds_wgs84;
  const coordinate = {
    longitude: bounds.west + (x / region.viewport.width) * (bounds.east - bounds.west),
    latitude: bounds.north - (y / region.viewport.height) * (bounds.north - bounds.south),
  };
  return geographicLocationFromCoordinate(coordinate, region);
}

export function geographicLocationIsValid(
  value: unknown,
  region: GeographicRegion = loadAkureSouthRegion(),
): value is GeographicLocation {
  try {
    const location = asRecord(value, "Geographic location");
    if (
      location.world_id !== "nigeria-main" ||
      location.region_id !== region.id ||
      location.country_id !== "NG" ||
      location.state_id !== region.state_id ||
      location.lga_id !== region.lga_id ||
      location.settlement_id !== region.settlement_id ||
      (location.ward_id !== null && typeof location.ward_id !== "string") ||
      typeof location.chunk_id !== "string" ||
      !isCoordinate(location) ||
      typeof location.local_position_m !== "object" ||
      location.local_position_m === null ||
      Array.isArray(location.local_position_m)
    ) {
      return false;
    }
    const position = location.local_position_m as Record<string, unknown>;
    if (
      typeof position.x !== "number" ||
      !Number.isFinite(position.x) ||
      typeof position.y !== "number" ||
      !Number.isFinite(position.y)
    ) {
      return false;
    }
    const normalized = normalizeCoordinate(location);
    const expected = geographicLocationFromCoordinate(normalized, region);
    const expectedGamePosition = geographicToGamePosition(normalized, region.frame);
    return (
      expected.chunk_id === location.chunk_id &&
      expected.ward_id === location.ward_id &&
      Math.abs(position.x - expectedGamePosition.x) <= 0.01 &&
      Math.abs(position.y - expectedGamePosition.y) <= 0.01
    );
  } catch {
    return false;
  }
}

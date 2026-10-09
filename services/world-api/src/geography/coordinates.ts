import type { GeographicBounds, GeographicCoordinate, GeographicFrame } from "./types.js";

export const EARTH_RADIUS_METERS = 6_371_008.8;
export const GEOGRAPHIC_COORDINATE_DECIMAL_PLACES = 7;
export const GAME_POSITION_PRECISION_METERS = 0.001;
export const GEOGRAPHIC_CHUNK_SIZE_METERS = 500;
export const GEOGRAPHIC_CHUNK_CENTRAL_LATITUDE_DEGREES = 9;
export const DEFAULT_GEOGRAPHIC_CHUNK_RADIUS = 1;

export interface Point2DLike {
  readonly x: number;
  readonly y: number;
}

export interface ChunkCoordinate {
  readonly column: number;
  readonly row: number;
  readonly id: string;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export const NIGERIA_GEOGRAPHIC_FRAME: GeographicFrame = Object.freeze({
  projection: "local-equirectangular-v1",
  origin: Object.freeze({ latitude: 9, longitude: 8 }),
  earth_radius_m: EARTH_RADIUS_METERS,
  game_units_per_meter: 1,
  precision_meters: GAME_POSITION_PRECISION_METERS,
  coordinate_decimal_places: GEOGRAPHIC_COORDINATE_DECIMAL_PLACES,
  axis_convention: "x-east-y-south",
});

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function roundTo(value: number, places: number): number {
  const rounded = Number(value.toFixed(places));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertPositiveScale(unitsPerMeter: number): void {
  if (!Number.isFinite(unitsPerMeter) || unitsPerMeter <= 0) {
    throw new Error("Game units per meter must be a finite positive number.");
  }
}

export function isGeographicCoordinate(value: unknown): value is GeographicCoordinate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const coordinate = value as Record<string, unknown>;
  return (
    typeof coordinate.latitude === "number" &&
    Number.isFinite(coordinate.latitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    typeof coordinate.longitude === "number" &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180
  );
}

export function normalizeCoordinate(coordinate: GeographicCoordinate): GeographicCoordinate {
  if (!isGeographicCoordinate(coordinate)) {
    throw new Error("Latitude and longitude must be finite WGS84 decimal degrees.");
  }
  return Object.freeze({
    latitude: roundTo(coordinate.latitude, GEOGRAPHIC_COORDINATE_DECIMAL_PLACES),
    longitude: roundTo(coordinate.longitude, GEOGRAPHIC_COORDINATE_DECIMAL_PLACES),
  });
}

/** Converts WGS84 to a local equirectangular frame; x=east, y=south, units default to meters. */
export function geographicToGamePosition(
  coordinate: GeographicCoordinate,
  frame: GeographicFrame = NIGERIA_GEOGRAPHIC_FRAME,
  unitsPerMeter = frame.game_units_per_meter,
): Point2DLike {
  const normalized = normalizeCoordinate(coordinate);
  assertPositiveScale(unitsPerMeter);
  const originLatitude = toRadians(frame.origin.latitude);
  const longitudeDelta = toRadians(normalized.longitude - frame.origin.longitude);
  const latitudeDelta = toRadians(normalized.latitude - frame.origin.latitude);
  return Object.freeze({
    x: roundTo(
      frame.earth_radius_m * Math.cos(originLatitude) * longitudeDelta * unitsPerMeter,
      3,
    ),
    y: roundTo(-frame.earth_radius_m * latitudeDelta * unitsPerMeter, 3),
  });
}

/** Inverse of geographicToGamePosition, rounded to the documented 1e-7 degree precision. */
export function gamePositionToGeographic(
  position: Point2DLike,
  frame: GeographicFrame = NIGERIA_GEOGRAPHIC_FRAME,
  unitsPerMeter = frame.game_units_per_meter,
): GeographicCoordinate {
  assertPositiveScale(unitsPerMeter);
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error("Game position must contain finite x and y values.");
  }
  const originLatitude = toRadians(frame.origin.latitude);
  const longitudeScale = Math.cos(originLatitude);
  if (Math.abs(longitudeScale) < 1e-12) {
    throw new Error("The local equirectangular frame is undefined at this origin latitude.");
  }
  return normalizeCoordinate({
    latitude:
      frame.origin.latitude -
      toDegrees(position.y / (frame.earth_radius_m * unitsPerMeter)),
    longitude:
      frame.origin.longitude +
      toDegrees(position.x / (frame.earth_radius_m * longitudeScale * unitsPerMeter)),
  });
}

export function geographicDistanceMeters(
  left: GeographicCoordinate,
  right: GeographicCoordinate,
): number {
  const first = normalizeCoordinate(left);
  const second = normalizeCoordinate(right);
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/** Stable Nigeria-wide 500 m grid; cell origin is tied to the equator and 9 degrees latitude. */
export function chunkForCoordinate(
  coordinate: GeographicCoordinate,
  chunkSizeMeters = GEOGRAPHIC_CHUNK_SIZE_METERS,
): ChunkCoordinate {
  const normalized = normalizeCoordinate(coordinate);
  if (!Number.isFinite(chunkSizeMeters) || chunkSizeMeters <= 0) {
    throw new Error("Chunk size must be a finite positive number.");
  }
  const globalX =
    EARTH_RADIUS_METERS *
    Math.cos(toRadians(GEOGRAPHIC_CHUNK_CENTRAL_LATITUDE_DEGREES)) *
    toRadians(normalized.longitude);
  const globalY = EARTH_RADIUS_METERS * toRadians(normalized.latitude);
  const column = Math.floor(globalX / chunkSizeMeters);
  const row = Math.floor(globalY / chunkSizeMeters);
  const roundedSize = roundTo(chunkSizeMeters, 3);
  const id = `ng:${roundedSize}m:${column}:${row}`;
  return Object.freeze({ column, row, id });
}

export function parseChunkId(
  chunkId: string,
  chunkSizeMeters = GEOGRAPHIC_CHUNK_SIZE_METERS,
): { column: number; row: number } | null {
  const roundedSize = roundTo(chunkSizeMeters, 3);
  const match = new RegExp(`^ng:${roundedSize}m:(-?\\d+):(-?\\d+)$`).exec(chunkId);
  if (match === null) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  return Number.isSafeInteger(column) && Number.isSafeInteger(row) ? { column, row } : null;
}

export function chunksWithinRadius(
  centerChunkId: string,
  radiusChunks: number,
  chunkSizeMeters = GEOGRAPHIC_CHUNK_SIZE_METERS,
): readonly string[] {
  if (!Number.isSafeInteger(radiusChunks) || radiusChunks < 0 || radiusChunks > 20) {
    throw new Error("Chunk radius must be an integer between 0 and 20.");
  }
  const center = parseChunkId(centerChunkId, chunkSizeMeters);
  if (center === null) throw new Error(`Invalid geographic chunk id: ${centerChunkId}`);
  const chunks: string[] = [];
  const roundedSize = roundTo(chunkSizeMeters, 3);
  for (let row = center.row - radiusChunks; row <= center.row + radiusChunks; row += 1) {
    for (let column = center.column - radiusChunks; column <= center.column + radiusChunks; column += 1) {
      chunks.push(`ng:${roundedSize}m:${column}:${row}`);
    }
  }
  return Object.freeze(chunks);
}

export function chunksAreWithinRadius(
  firstChunkId: string,
  secondChunkId: string,
  radiusChunks: number,
  chunkSizeMeters = GEOGRAPHIC_CHUNK_SIZE_METERS,
): boolean {
  const first = parseChunkId(firstChunkId, chunkSizeMeters);
  const second = parseChunkId(secondChunkId, chunkSizeMeters);
  return (
    first !== null &&
    second !== null &&
    Math.abs(first.column - second.column) <= radiusChunks &&
    Math.abs(first.row - second.row) <= radiusChunks
  );
}

export function coordinateToViewport(
  coordinate: GeographicCoordinate,
  bounds: GeographicBounds,
  viewport: ViewportSize,
): Point2DLike {
  const normalized = normalizeCoordinate(coordinate);
  validateBounds(bounds);
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Viewport width and height must be finite positive numbers.");
  }
  return Object.freeze({
    x: ((normalized.longitude - bounds.west) / (bounds.east - bounds.west)) * viewport.width,
    y: ((bounds.north - normalized.latitude) / (bounds.north - bounds.south)) * viewport.height,
  });
}

export function viewportToCoordinate(
  position: Point2DLike,
  bounds: GeographicBounds,
  viewport: ViewportSize,
): GeographicCoordinate {
  validateBounds(bounds);
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error("Viewport position and dimensions must be finite; dimensions must be positive.");
  }
  const x = Math.max(0, Math.min(viewport.width, position.x));
  const y = Math.max(0, Math.min(viewport.height, position.y));
  return normalizeCoordinate({
    longitude: bounds.west + (x / viewport.width) * (bounds.east - bounds.west),
    latitude: bounds.north - (y / viewport.height) * (bounds.north - bounds.south),
  });
}

export function coordinateIsWithinBounds(
  coordinate: GeographicCoordinate,
  bounds: GeographicBounds,
): boolean {
  const normalized = normalizeCoordinate(coordinate);
  validateBounds(bounds);
  return (
    normalized.longitude >= bounds.west &&
    normalized.longitude <= bounds.east &&
    normalized.latitude >= bounds.south &&
    normalized.latitude <= bounds.north
  );
}

function validateBounds(bounds: GeographicBounds): void {
  if (
    !Number.isFinite(bounds.west) ||
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.east) ||
    !Number.isFinite(bounds.north) ||
    bounds.west >= bounds.east ||
    bounds.south >= bounds.north
  ) {
    throw new Error("Geographic bounds must be a valid WGS84 west/south/east/north rectangle.");
  }
}

import {
  chunkForCoordinate,
  coordinateIsWithinBounds,
  geographicDistanceMeters,
  geographicToGamePosition,
  NIGERIA_GEOGRAPHIC_FRAME,
  normalizeCoordinate,
} from "./coordinates.js";
import type {
  GeoJSONGeometry,
  GeographicAsset,
  GeographicBounds,
  GeographicCoordinate,
  GeographicLocation,
  GeographicRegion,
  GeographyImportResult,
  NigerianAdminData,
} from "./types.js";

const NIGERIA_VALIDATION_BOUNDS: GeographicBounds = {
  west: 2.5,
  south: 3.5,
  east: 15,
  north: 15,
};
const FEATURE_SAFETY_MARGIN_DEGREES = 0.05;
const MAX_OSM_FEATURES = 500;
const EXPECTED_STATE_COUNT = 37;
const REGION_LGA_ID = "ng:lga:on:akure-south";
const REGION_SETTLEMENT_ID = "ng:settlement:on:akure";
const WARD_SPAWN_NAME = "Ijomu/Obanla";
const REGION_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_LICENSE_URL = "https://www.openstreetmap.org/copyright";

interface LgaSourceRow {
  readonly id: number;
  readonly name: string;
  readonly state_code: string;
  readonly state_name: string;
  readonly country_code: string;
  readonly country_name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly wikiDataId?: string;
}

interface WardSourceRow {
  readonly State: string;
  readonly LGA: string;
  readonly Ward: string;
  readonly Latitude: number;
  readonly Longitude: number;
}

interface SettlementSource {
  readonly name: string;
  readonly capital: string;
  readonly towns: readonly string[];
}

interface RegionSelection {
  readonly regionId: string;
  readonly regionName: string;
  readonly stateName: string;
  readonly lgaName: string;
  readonly clipBoundsWgs84: GeographicBounds;
  readonly localFrameOriginWgs84: { readonly latitude: number; readonly longitude: number };
  readonly sourceSnapshotUtc: string;
  readonly coordinateReferenceSystem: string;
  readonly sourceArtifact: {
    readonly provider: string;
    readonly repositoryUrl: string;
    readonly repositoryCommit: string;
    readonly previewPath: string;
    readonly previewGitBlobSha1: string;
    readonly previewBytes: number;
    readonly previewSha256: string;
    readonly osmSnapshotUtc: string;
    readonly dataLicense: string;
    readonly attribution: string;
    readonly attributionUrl: string;
    readonly crsAssumption: string;
    readonly crsReview: string;
  };
  readonly sourceLayerKinds: Readonly<Record<string, GeographicAsset["kind"]>>;
  readonly selectionNote: string;
}

interface RawGeoJSONFeature {
  readonly type: "Feature";
  readonly id?: string | number;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly geometry: unknown;
}

interface RawFeatureCollection {
  readonly type: "FeatureCollection";
  readonly name?: string;
  readonly bbox?: readonly number[];
  readonly features: readonly RawGeoJSONFeature[];
}

interface ValidatedGeometry {
  readonly geometry: GeoJSONGeometry;
  readonly positions: readonly GeographicCoordinate[];
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be a JSON array.`);
  return value;
}

function text(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return value.trim();
}

function numeric(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number.`);
  }
  return value;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stableStateId(stateCode: string): string {
  return `ng:state:${stateCode.toLowerCase()}`;
}

function stableLgaId(stateCode: string, lgaName: string): string {
  return `ng:lga:${stateCode.toLowerCase()}:${slugify(lgaName)}`;
}

function coordinateFromPosition(position: readonly unknown[], context: string): GeographicCoordinate {
  if (position.length < 2) throw new Error(`${context} must be a [longitude, latitude] pair.`);
  const longitude = numeric(position[0], `${context} longitude`);
  const latitude = numeric(position[1], `${context} latitude`);
  const coordinate = normalizeCoordinate({ latitude, longitude });
  if (!coordinateIsWithinBounds(coordinate, NIGERIA_VALIDATION_BOUNDS)) {
    throw new Error(`${context} is outside the broad Nigeria validation window.`);
  }
  return coordinate;
}

function positionsFromCoordinates(
  geometryType: string,
  rawCoordinates: unknown,
  context: string,
): GeographicCoordinate[] {
  const positions: GeographicCoordinate[] = [];
  const position = (value: unknown, name: string): GeographicCoordinate => {
    const values = list(value, name);
    return coordinateFromPosition(values, name);
  };
  const line = (value: unknown, name: string, requireClosedRing = false): void => {
    const values = list(value, name);
    const minimumLength = requireClosedRing ? 4 : 2;
    if (values.length < minimumLength) {
      throw new Error(`${name} must contain at least ${minimumLength} coordinates.`);
    }
    const linePositions = values.map((item, index) => position(item, `${name}[${index}]`));
    if (
      requireClosedRing &&
      (linePositions[0]?.latitude !== linePositions.at(-1)?.latitude ||
        linePositions[0]?.longitude !== linePositions.at(-1)?.longitude)
    ) {
      throw new Error(`${name} polygon ring must be closed.`);
    }
    positions.push(...linePositions);
  };
  const polygon = (value: unknown, name: string): void => {
    const rings = list(value, name);
    if (rings.length === 0) throw new Error(`${name} polygon must contain an outer ring.`);
    rings.forEach((ring, index) => line(ring, `${name}[${index}]`, true));
  };
  const nested = (value: unknown, name: string): readonly unknown[] => list(value, name);

  switch (geometryType) {
    case "Point":
      positions.push(position(rawCoordinates, context));
      break;
    case "MultiPoint":
      nested(rawCoordinates, context).forEach((item, index) =>
        positions.push(position(item, `${context}[${index}]`)),
      );
      break;
    case "LineString":
      line(rawCoordinates, context);
      break;
    case "MultiLineString":
      nested(rawCoordinates, context).forEach((item, index) =>
        line(item, `${context}[${index}]`),
      );
      break;
    case "Polygon":
      polygon(rawCoordinates, context);
      break;
    case "MultiPolygon":
      nested(rawCoordinates, context).forEach((item, index) =>
        polygon(item, `${context}[${index}]`),
      );
      break;
    default:
      throw new Error(`${context} uses unsupported GeoJSON geometry type ${geometryType}.`);
  }
  if (positions.length === 0) throw new Error(`${context} geometry must contain coordinates.`);
  return positions;
}

function validateGeometry(value: unknown, context: string): ValidatedGeometry {
  const raw = record(value, context);
  const geometryType = text(raw.type, `${context}.type`);
  const coordinates = raw.coordinates;
  const positions = positionsFromCoordinates(geometryType, coordinates, context);
  const geometry = { type: geometryType, coordinates } as GeoJSONGeometry;
  return { geometry, positions };
}

function safeFeatureBounds(positions: readonly GeographicCoordinate[], viewport: GeographicBounds): void {
  const safe = {
    west: viewport.west - FEATURE_SAFETY_MARGIN_DEGREES,
    south: viewport.south - FEATURE_SAFETY_MARGIN_DEGREES,
    east: viewport.east + FEATURE_SAFETY_MARGIN_DEGREES,
    north: viewport.north + FEATURE_SAFETY_MARGIN_DEGREES,
  };
  if (!positions.some((coordinate) => coordinateIsWithinBounds(coordinate, viewport))) {
    throw new Error("An OSM feature has no coordinates inside the declared preview viewport.");
  }
  if (positions.some((coordinate) => !coordinateIsWithinBounds(coordinate, safe))) {
    throw new Error("An OSM feature exceeds the documented geometry safety margin around the viewport.");
  }
}

function chunkIdsForBounds(positions: readonly GeographicCoordinate[]): readonly string[] {
  const longitudes = positions.map((coordinate) => coordinate.longitude);
  const latitudes = positions.map((coordinate) => coordinate.latitude);
  const corners = [
    { latitude: Math.min(...latitudes), longitude: Math.min(...longitudes) },
    { latitude: Math.min(...latitudes), longitude: Math.max(...longitudes) },
    { latitude: Math.max(...latitudes), longitude: Math.min(...longitudes) },
    { latitude: Math.max(...latitudes), longitude: Math.max(...longitudes) },
  ];
  const chunkCorners = corners.map((coordinate) => chunkForCoordinate(coordinate));
  const minColumn = Math.min(...chunkCorners.map((chunk) => chunk.column));
  const maxColumn = Math.max(...chunkCorners.map((chunk) => chunk.column));
  const minRow = Math.min(...chunkCorners.map((chunk) => chunk.row));
  const maxRow = Math.max(...chunkCorners.map((chunk) => chunk.row));
  const ids = new Set<string>();
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      ids.add(`ng:500m:${column}:${row}`);
    }
  }
  return Object.freeze([...ids].sort((left, right) => left.localeCompare(right)));
}

function makeLocation(
  coordinate: GeographicCoordinate,
  regionId: string,
  frameOrigin: GeographicCoordinate,
  stateId: string,
  lgaId: string,
  settlementId: string | null,
  wards: readonly GeographicRegion["wards"][number][],
): GeographicLocation {
  const normalized = normalizeCoordinate(coordinate);
  let nearestWard: GeographicRegion["wards"][number] | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const ward of wards) {
    const distance = geographicDistanceMeters(normalized, ward.coordinate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestWard = ward;
    }
  }
  // Ward rows are reference points only. We only attach a ward at essentially that point,
  // not by pretending the reference coordinate is a ward boundary or polygon centroid.
  const wardId = nearestDistance <= 1 ? (nearestWard?.id ?? null) : null;
  const localPosition = geographicToGamePosition(normalized, {
    ...NIGERIA_GEOGRAPHIC_FRAME,
    origin: frameOrigin,
  });
  return Object.freeze({
    world_id: "nigeria-main",
    region_id: regionId,
    country_id: "NG",
    state_id: stateId,
    lga_id: lgaId,
    settlement_id: settlementId,
    ward_id: wardId,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    local_position_m: localPosition,
    chunk_id: chunkForCoordinate(normalized).id,
  });
}

function parseLgaRows(value: unknown): LgaSourceRow[] {
  return list(value, "LGA source").map((item, index) => {
    const row = record(item, `LGA source[${index}]`);
    return {
      id: numeric(row.id, `LGA source[${index}].id`),
      name: text(row.name, `LGA source[${index}].name`),
      state_code: text(row.state_code, `LGA source[${index}].state_code`),
      state_name: text(row.state_name, `LGA source[${index}].state_name`),
      country_code: text(row.country_code, `LGA source[${index}].country_code`),
      country_name: text(row.country_name, `LGA source[${index}].country_name`),
      latitude: numeric(row.latitude, `LGA source[${index}].latitude`),
      longitude: numeric(row.longitude, `LGA source[${index}].longitude`),
      ...(typeof row.wikiDataId === "string" ? { wikiDataId: row.wikiDataId } : {}),
    };
  });
}

function parseWardRows(value: unknown): WardSourceRow[] {
  return list(value, "Akure South ward source").map((item, index) => {
    const row = record(item, `ward source[${index}]`);
    return {
      State: text(row.State, `ward source[${index}].State`),
      LGA: text(row.LGA, `ward source[${index}].LGA`),
      Ward: text(row.Ward, `ward source[${index}].Ward`),
      Latitude: numeric(row.Latitude, `ward source[${index}].Latitude`),
      Longitude: numeric(row.Longitude, `ward source[${index}].Longitude`),
    };
  });
}

function parseSelection(value: unknown): RegionSelection {
  const source = record(value, "OSM selection manifest");
  const bounds = record(source.clipBoundsWgs84, "OSM selection clipBoundsWgs84");
  const origin = record(source.localFrameOriginWgs84, "OSM local frame origin");
  const kinds = record(source.sourceLayerKinds, "OSM source layer mapping");
  const sourceLayerKinds: Record<string, GeographicAsset["kind"]> = {};
  for (const [layer, kind] of Object.entries(kinds)) {
    if (
      kind !== "road" &&
      kind !== "building" &&
      kind !== "waterway" &&
      kind !== "landuse" &&
      kind !== "health_facility" &&
      kind !== "school"
    ) {
      throw new Error(`OSM layer ${layer} has an unsupported normalized kind.`);
    }
    sourceLayerKinds[layer] = kind;
  }
  const parsedBounds: GeographicBounds = {
    west: numeric(bounds.west, "clipBoundsWgs84.west"),
    south: numeric(bounds.south, "clipBoundsWgs84.south"),
    east: numeric(bounds.east, "clipBoundsWgs84.east"),
    north: numeric(bounds.north, "clipBoundsWgs84.north"),
  };
  if (
    parsedBounds.west >= parsedBounds.east ||
    parsedBounds.south >= parsedBounds.north ||
    !coordinateIsWithinBounds(
      { latitude: (parsedBounds.south + parsedBounds.north) / 2, longitude: (parsedBounds.west + parsedBounds.east) / 2 },
      NIGERIA_VALIDATION_BOUNDS,
    )
  ) {
    throw new Error("OSM selection must use a valid viewport located in Nigeria.");
  }
  const timestamp = text(source.sourceSnapshotUtc, "sourceSnapshotUtc");
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("sourceSnapshotUtc must be an ISO timestamp.");
  if (source.coordinateReferenceSystem !== "OGC:CRS84") {
    throw new Error("OSM preview coordinates must be explicitly declared as OGC:CRS84 longitude/latitude.");
  }
  const sourceArtifact = record(source.sourceArtifact, "OSM source artifact provenance");
  const artifact = {
    provider: text(sourceArtifact.provider, "sourceArtifact.provider"),
    repositoryUrl: text(sourceArtifact.repositoryUrl, "sourceArtifact.repositoryUrl"),
    repositoryCommit: text(sourceArtifact.repositoryCommit, "sourceArtifact.repositoryCommit"),
    previewPath: text(sourceArtifact.previewPath, "sourceArtifact.previewPath"),
    previewGitBlobSha1: text(sourceArtifact.previewGitBlobSha1, "sourceArtifact.previewGitBlobSha1"),
    previewBytes: numeric(sourceArtifact.previewBytes, "sourceArtifact.previewBytes"),
    previewSha256: text(sourceArtifact.previewSha256, "sourceArtifact.previewSha256"),
    osmSnapshotUtc: text(sourceArtifact.osmSnapshotUtc, "sourceArtifact.osmSnapshotUtc"),
    dataLicense: text(sourceArtifact.dataLicense, "sourceArtifact.dataLicense"),
    attribution: text(sourceArtifact.attribution, "sourceArtifact.attribution"),
    attributionUrl: text(sourceArtifact.attributionUrl, "sourceArtifact.attributionUrl"),
    crsAssumption: text(sourceArtifact.crsAssumption, "sourceArtifact.crsAssumption"),
    crsReview: text(sourceArtifact.crsReview, "sourceArtifact.crsReview"),
  };
  if (
    artifact.provider !== "Mapkathon2026-UseOSM/lga-osm-extractor" ||
    artifact.repositoryCommit !== "414af2369c70ee5d5d3800cbed33a4bcf9370117" ||
    artifact.previewPath !== "visuals/akure_south_preview.html" ||
    !/^[a-f0-9]{40}$/.test(artifact.repositoryCommit) ||
    !/^[a-f0-9]{40}$/.test(artifact.previewGitBlobSha1) ||
    !/^[a-f0-9]{64}$/.test(artifact.previewSha256) ||
    artifact.previewBytes < 1 ||
    artifact.dataLicense !== "ODbL-1.0" ||
    artifact.attribution !== REGION_ATTRIBUTION ||
    artifact.attributionUrl !== OSM_LICENSE_URL ||
    artifact.osmSnapshotUtc !== timestamp ||
    artifact.crsAssumption !== "OGC:CRS84 with x=longitude and y=latitude" ||
    !artifact.crsReview.toLowerCase().includes("without an embedded crs field")
  ) {
    throw new Error("OSM source provenance, license, snapshot, or CRS review is inconsistent.");
  }
  return {
    regionId: text(source.regionId, "regionId"),
    regionName: text(source.regionName, "regionName"),
    stateName: text(source.stateName, "stateName"),
    lgaName: text(source.lgaName, "lgaName"),
    clipBoundsWgs84: parsedBounds,
    localFrameOriginWgs84: {
      latitude: numeric(origin.latitude, "localFrameOriginWgs84.latitude"),
      longitude: numeric(origin.longitude, "localFrameOriginWgs84.longitude"),
    },
    sourceSnapshotUtc: timestamp,
    coordinateReferenceSystem: "OGC:CRS84",
    sourceArtifact: artifact,
    sourceLayerKinds,
    selectionNote: text(source.selectionNote, "selectionNote"),
  };
}

function parseSettlement(value: unknown): SettlementSource {
  const source = record(value, "settlement source");
  return {
    name: text(source.name, "settlement source.name"),
    capital: text(source.capital, "settlement source.capital"),
    towns: list(source.towns, "settlement source.towns").map((town, index) =>
      text(town, `settlement source.towns[${index}]`),
    ),
  };
}

function buildAdminData(lgaRows: readonly LgaSourceRow[]): NigerianAdminData {
  if (lgaRows.length !== 774) {
    throw new Error(`Expected the pinned 774-row LGA source, received ${lgaRows.length}.`);
  }
  const sourceIdSet = new Set<number>();
  const stateNamesByCode = new Map<string, string>();
  const statesById = new Map<string, NigerianAdminData["states"][number]>();
  for (const row of lgaRows) {
    if (row.country_code !== "NG" || row.country_name !== "Nigeria") {
      throw new Error(`LGA source record ${row.id} is not under Nigeria.`);
    }
    if (!Number.isSafeInteger(row.id) || row.id < 1 || sourceIdSet.has(row.id)) {
      throw new Error(`LGA source id ${row.id} is invalid or duplicated.`);
    }
    sourceIdSet.add(row.id);
    const existingStateName = stateNamesByCode.get(row.state_code);
    if (existingStateName !== undefined && existingStateName !== row.state_name) {
      throw new Error(`State code ${row.state_code} maps to multiple state names.`);
    }
    stateNamesByCode.set(row.state_code, row.state_name);
    const coordinate = normalizeCoordinate({ latitude: row.latitude, longitude: row.longitude });
    if (!coordinateIsWithinBounds(coordinate, NIGERIA_VALIDATION_BOUNDS)) {
      throw new Error(`LGA reference point ${row.name}, ${row.state_name} is outside the Nigeria validation window.`);
    }
    const stateId = stableStateId(row.state_code);
    statesById.set(stateId, {
      id: stateId,
      name: row.state_name,
      source_code: row.state_code,
      kind: row.state_code === "FC" ? "federal_capital_territory" : "state",
      parent_id: "NG",
    });
  }
  if (statesById.size !== EXPECTED_STATE_COUNT || !stateNamesByCode.has("FC")) {
    throw new Error(`Expected 36 states plus FCT (${EXPECTED_STATE_COUNT} state codes).`);
  }
  const stateNameToId = new Map<string, string>();
  for (const state of statesById.values()) stateNameToId.set(state.name, state.id);

  const wikidataCounts = new Map<string, number>();
  for (const row of lgaRows) {
    if (row.wikiDataId !== undefined) {
      wikidataCounts.set(row.wikiDataId, (wikidataCounts.get(row.wikiDataId) ?? 0) + 1);
    }
  }
  const duplicateWikidataIds = [...wikidataCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const sourceWarnings = duplicateWikidataIds.map(
    (id) => `Omitted duplicated optional Wikidata identifier ${id}; canonical IDs use source code and normalized name.`,
  );
  const lgas = lgaRows
    .map((row) => {
      const wikidataId = row.wikiDataId;
      return {
        id: stableLgaId(row.state_code, row.name),
        name: row.name,
        state_id: stateNameToId.get(row.state_name) ?? stableStateId(row.state_code),
        coordinate: normalizeCoordinate({ latitude: row.latitude, longitude: row.longitude }),
        coordinate_role: "published_reference_point" as const,
        source_record_id: row.id,
        ...(wikidataId !== undefined && wikidataCounts.get(wikidataId) === 1
          ? { wikidata_id: wikidataId }
          : {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(lgas.map((lga) => lga.id)).size !== lgas.length) {
    throw new Error("Canonical LGA ids are not unique.");
  }
  return {
    schema_version: 1,
    world_id: "nigeria-main",
    country: { id: "NG", name: "Nigeria", iso_3166_1_alpha2: "NG", world_id: "nigeria-main" },
    states: [...statesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    lgas,
    source_warnings: sourceWarnings,
    coordinate_note:
      "Source LGA coordinates are published reference points, not verified LGA boundaries, centroids, or survey-grade positions.",
  };
}

function buildWards(
  wardRows: readonly WardSourceRow[],
  stateId: string,
  lgaId: string,
): GeographicRegion["wards"] {
  const seen = new Set<string>();
  return Object.freeze(
    wardRows
      .map((row) => {
        if (row.State !== "Ondo" || row.LGA !== "Akure South") {
          throw new Error(`Ward ${row.Ward} is not part of the pinned Ondo/Akure South selection.`);
        }
        const id = `ng:ward:on:akure-south:${slugify(row.Ward)}`;
        if (seen.has(id)) throw new Error(`Duplicate Akure South ward record ${row.Ward}.`);
        seen.add(id);
        const coordinate = normalizeCoordinate({ latitude: row.Latitude, longitude: row.Longitude });
        if (!coordinateIsWithinBounds(coordinate, NIGERIA_VALIDATION_BOUNDS)) {
          throw new Error(`Ward reference point ${row.Ward} is outside the Nigeria validation window.`);
        }
        return {
          id,
          name: row.Ward,
          lga_id: lgaId,
          coordinate,
          coordinate_role: "published_reference_point" as const,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function buildFeatures(
  collectionValue: unknown,
  selection: RegionSelection,
): { features: GeographicAsset[]; featureCounts: Record<string, number> } {
  const collection = record(collectionValue, "OSM GeoJSON collection") as unknown as RawFeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("OSM input must be a GeoJSON FeatureCollection.");
  }
  if (collection.features.length < 50 || collection.features.length > MAX_OSM_FEATURES) {
    throw new Error(`Bounded OSM sample must contain between 50 and ${MAX_OSM_FEATURES} features.`);
  }
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  const features = collection.features.map((raw, index): GeographicAsset => {
    const sourceFeature = record(raw, `OSM feature[${index}]`);
    if (sourceFeature.type !== "Feature") throw new Error(`OSM feature[${index}] is not a GeoJSON Feature.`);
    const properties = record(sourceFeature.properties, `OSM feature[${index}].properties`);
    const id = text(properties.source_feature_id ?? sourceFeature.id, `OSM feature[${index}] source id`);
    if (ids.has(id)) throw new Error(`Duplicate OSM feature id ${id}.`);
    ids.add(id);
    const osmId = text(properties.osm_id, `${id}.osm_id`);
    if (!/^\d+$/.test(osmId)) throw new Error(`OSM feature ${id} has an invalid source element id.`);
    const layer = text(properties.source_layer, `${id}.source_layer`);
    const kind = selection.sourceLayerKinds[layer];
    if (kind === undefined) throw new Error(`OSM feature ${id} uses unapproved source layer ${layer}.`);
    const validated = validateGeometry(sourceFeature.geometry, `OSM feature ${id}.geometry`);
    safeFeatureBounds(validated.positions, selection.clipBoundsWgs84);
    const name = typeof properties.name === "string" && properties.name.trim() ? properties.name.trim() : null;
    counts[kind] = (counts[kind] ?? 0) + 1;
    return {
      id,
      kind,
      name,
      source_layer: layer,
      osm_id: osmId,
      lga_id: REGION_LGA_ID,
      geometry: validated.geometry,
      chunk_ids: chunkIdsForBounds(validated.positions),
    };
  });
  features.sort((left, right) => left.id.localeCompare(right.id));
  return { features, featureCounts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) };
}

export function buildGeographyFromSources(sources: {
  readonly lgas: unknown;
  readonly wards: unknown;
  readonly settlement: unknown;
  readonly selection: unknown;
  readonly osm: unknown;
}): GeographyImportResult {
  const lgaRows = parseLgaRows(sources.lgas);
  const admin = buildAdminData(lgaRows);
  const selection = parseSelection(sources.selection);
  if (selection.stateName !== "Ondo" || selection.lgaName !== "Akure South") {
    throw new Error("The pinned playable-region source selection must match Ondo/Akure South.");
  }
  const state = admin.states.find((candidate) => candidate.name === selection.stateName);
  const lga = admin.lgas.find((candidate) => candidate.name === selection.lgaName && candidate.state_id === state?.id);
  if (state === undefined || lga === undefined || lga.id !== REGION_LGA_ID) {
    throw new Error("The selected Akure South region has no matching canonical state/LGA record.");
  }
  const settlement = parseSettlement(sources.settlement);
  if (
    settlement.name !== selection.stateName ||
    settlement.capital !== "Akure" ||
    !settlement.towns.includes("Akure")
  ) {
    throw new Error("Pinned settlement source does not confirm Akure as the Ondo capital/town.");
  }
  const wardRows = parseWardRows(sources.wards);
  if (wardRows.length !== 11) throw new Error(`Expected the pinned 11-row ward subset; received ${wardRows.length}.`);
  const wards = buildWards(wardRows, state.id, lga.id);
  const spawnWard = wards.find((ward) => ward.name === WARD_SPAWN_NAME);
  if (spawnWard === undefined || !coordinateIsWithinBounds(spawnWard.coordinate, selection.clipBoundsWgs84)) {
    throw new Error("The documented Ijomu/Obanla reference point is missing or outside the sample viewport.");
  }
  const { features, featureCounts } = buildFeatures(sources.osm, selection);
  const origin = normalizeCoordinate(selection.localFrameOriginWgs84);
  const spawnLocation = makeLocation(
    spawnWard.coordinate,
    selection.regionId,
    origin,
    state.id,
    lga.id,
    REGION_SETTLEMENT_ID,
    wards,
  );
  if (spawnLocation.ward_id !== spawnWard.id) {
    throw new Error("Ward reference point did not resolve to its own stable ward identifier.");
  }
  const region: GeographicRegion = {
    schema_version: 1,
    world_id: "nigeria-main",
    id: selection.regionId,
    name: selection.regionName,
    state_id: state.id,
    lga_id: lga.id,
    settlement_id: REGION_SETTLEMENT_ID,
    frame: { ...NIGERIA_GEOGRAPHIC_FRAME, origin },
    viewport: {
      bounds_wgs84: selection.clipBoundsWgs84,
      width: 1600,
      height: 900,
    },
    chunk_grid: {
      id_scheme: "ng-equirectangular-9n-v1",
      size_meters: 500,
      central_latitude_degrees: 9,
      interest_radius_chunks: 1,
    },
    settlement: {
      id: REGION_SETTLEMENT_ID,
      name: settlement.capital,
      state_id: state.id,
      related_lga_ids: [lga.id],
      relationship_note:
        "Sample association only: the source confirms Akure as Ondo's capital/town but supplies no coordinate or administrative boundary for the settlement.",
      coordinate: null,
      coordinate_note: "No authoritative settlement coordinate was supplied by the pinned settlement-name source.",
    },
    wards,
    spawn_location: spawnLocation,
    features,
    feature_counts: featureCounts,
    extensions: { regional_environment_profile_id: null, transport_network_id: null },
    streaming: {
      content_chunk_ids: Object.freeze(
        [...new Set(features.flatMap((feature) => feature.chunk_ids))].sort((left, right) => left.localeCompare(right)),
      ),
      client_chunk_radius: 1,
      notes:
        "This bounded prototype sample is loaded as one small content file. Feature chunk IDs support later per-chunk loading; no full-world or national visual data is downloaded.",
    },
    attribution: {
      text: REGION_ATTRIBUTION,
      license: "ODbL-1.0",
      source_url: OSM_LICENSE_URL,
    },
  };
  return { admin, region };
}

export function createGeographicLocation(
  region: GeographicRegion,
  coordinate: GeographicCoordinate,
): GeographicLocation {
  const normalized = normalizeCoordinate(coordinate);
  if (!coordinateIsWithinBounds(normalized, region.viewport.bounds_wgs84)) {
    throw new Error(`Coordinate is outside geographic region ${region.id}.`);
  }
  return makeLocation(
    normalized,
    region.id,
    region.frame.origin,
    region.state_id,
    region.lga_id,
    region.settlement_id,
    region.wards,
  );
}

export function geographicAssetsForChunks(
  region: GeographicRegion,
  chunkIds: ReadonlySet<string>,
): readonly GeographicAsset[] {
  if (chunkIds.size === 0) return Object.freeze([]);
  return Object.freeze(region.features.filter((feature) => feature.chunk_ids.some((id) => chunkIds.has(id))));
}

export function viewportCoordinateForRegion(
  region: GeographicRegion,
  position: { readonly x: number; readonly y: number },
): GeographicCoordinate {
  const x = Math.max(0, Math.min(region.viewport.width, position.x));
  const y = Math.max(0, Math.min(region.viewport.height, position.y));
  return normalizeCoordinate({
    longitude:
      region.viewport.bounds_wgs84.west +
      (x / region.viewport.width) *
        (region.viewport.bounds_wgs84.east - region.viewport.bounds_wgs84.west),
    latitude:
      region.viewport.bounds_wgs84.north -
      (y / region.viewport.height) *
        (region.viewport.bounds_wgs84.north - region.viewport.bounds_wgs84.south),
  });
}

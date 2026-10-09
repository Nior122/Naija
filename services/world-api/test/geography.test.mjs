import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  chunkForCoordinate,
  chunksAreWithinRadius,
  chunksWithinRadius,
  coordinateToViewport,
  gamePositionToGeographic,
  geographicDistanceMeters,
  geographicToGamePosition,
  viewportToCoordinate,
} from "../dist/geography/coordinates.js";
import {
  geographicAssetsForChunks,
  buildGeographyFromSources,
} from "../dist/geography/importer.js";
import {
  geographicLocationForMapPosition,
  geographicLocationFromCoordinate,
  geographicLocationIsValid,
  loadAkureSouthRegion,
} from "../dist/geography/catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceDirectory = join(root, "game/data/geography/source");
const processedDirectory = join(root, "game/data/geography/processed");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadSources() {
  const [lgas, wards, settlement, selection, osm] = await Promise.all([
    readJson(join(sourceDirectory, "admin/nigerian-lgas.json")),
    readJson(join(sourceDirectory, "admin/akure-south-wards.json")),
    readJson(join(sourceDirectory, "admin/ondo-akure-settlement.json")),
    readJson(join(sourceDirectory, "osm/akure-south-selection.json")),
    readJson(join(sourceDirectory, "osm/akure-south-core.geojson")),
  ]);
  return { lgas, wards, settlement, selection, osm };
}

test("administrative import pins one Nigeria with 36 states, FCT and 774 canonical LGAs", async () => {
  const { admin } = buildGeographyFromSources(await loadSources());
  assert.equal(admin.country.id, "NG");
  assert.equal(admin.world_id, "nigeria-main");
  assert.equal(admin.states.length, 37);
  assert.equal(admin.states.filter((state) => state.kind === "state").length, 36);
  assert.equal(admin.states.filter((state) => state.kind === "federal_capital_territory").length, 1);
  assert.equal(admin.states.find((state) => state.name === "Ondo").id, "ng:state:on");
  assert.equal(admin.states.find((state) => state.name === "Federal Capital Territory").id, "ng:state:fc");
  assert.equal(admin.lgas.length, 774);
  assert.equal(new Set(admin.lgas.map((lga) => lga.id)).size, 774);
  const akureSouth = admin.lgas.find((lga) => lga.id === "ng:lga:on:akure-south");
  assert.equal(akureSouth.state_id, "ng:state:on");
  assert.equal(akureSouth.coordinate_role, "published_reference_point");
  assert.equal(akureSouth.wikidata_id, "Q4701976");
  assert.equal(admin.lgas.some((lga) => ["Q4207508", "Q836645", "Q994119"].includes(lga.wikidata_id)), false);
  assert.equal(admin.source_warnings.length, 3);
  assert.ok(admin.coordinate_note.includes("not verified LGA boundaries"));
});

test("Akure South sample preserves mapped feature classes, attribution and explicit coverage limits", async () => {
  const { region } = buildGeographyFromSources(await loadSources());
  assert.equal(region.world_id, "nigeria-main");
  assert.equal(region.state_id, "ng:state:on");
  assert.equal(region.lga_id, "ng:lga:on:akure-south");
  assert.equal(region.features.length, 200);
  assert.deepEqual(region.feature_counts, {
    building: 108,
    health_facility: 3,
    landuse: 2,
    road: 72,
    school: 2,
    waterway: 13,
  });
  assert.equal(new Set(region.features.map((feature) => feature.id)).size, 200);
  assert.ok(region.features.every((feature) => feature.chunk_ids.length > 0));
  assert.equal(region.attribution.text, "© OpenStreetMap contributors");
  assert.equal(region.attribution.license, "ODbL-1.0");
  assert.equal(region.settlement.coordinate, null);
  assert.equal(region.spawn_location.ward_id, "ng:ward:on:akure-south:ijomu-obanla");
  assert.equal(region.spawn_location.latitude, 7.2561764);
  assert.equal(region.spawn_location.longitude, 5.1933903);
  assert.ok(region.settlement.relationship_note.includes("Sample association only"));
  assert.ok(region.streaming.notes.includes("bounded prototype sample"));
  assert.equal(region.extensions.regional_environment_profile_id, null);
  assert.equal(region.extensions.transport_network_id, null);
});

test("geography import rejects malformed source coordinates, CRS changes and duplicate feature identifiers", async () => {
  const sources = await loadSources();
  const invalidCrs = structuredClone(sources);
  invalidCrs.selection.coordinateReferenceSystem = "EPSG:4326";
  assert.throws(() => buildGeographyFromSources(invalidCrs), /OGC:CRS84/);

  const invalidCoordinate = structuredClone(sources);
  invalidCoordinate.osm.features[0].geometry.coordinates[0][0][0] = 190;
  assert.throws(
    () => buildGeographyFromSources(invalidCoordinate),
    /finite WGS84 decimal degrees|outside the broad Nigeria validation window/,
  );

  const duplicateFeature = structuredClone(sources);
  duplicateFeature.osm.features[1].properties.source_feature_id =
    duplicateFeature.osm.features[0].properties.source_feature_id;
  assert.throws(() => buildGeographyFromSources(duplicateFeature), /Duplicate OSM feature id/);

  const duplicateLgaSourceId = structuredClone(sources);
  duplicateLgaSourceId.lgas[1].id = duplicateLgaSourceId.lgas[0].id;
  assert.throws(() => buildGeographyFromSources(duplicateLgaSourceId), /invalid or duplicated/);
});

test("processed outputs exactly match the deterministic importer", async () => {
  const result = buildGeographyFromSources(await loadSources());
  const [admin, region] = await Promise.all([
    readJson(join(processedDirectory, "nigeria-admin.json")),
    readJson(join(processedDirectory, "akure-south-core.json")),
  ]);
  assert.deepEqual(admin, result.admin);
  assert.deepEqual(region, result.region);
});

test("WGS84 conversion is deterministic, reversible and uses east-positive / south-positive axes", async () => {
  const { region } = buildGeographyFromSources(await loadSources());
  const origin = region.frame.origin;
  assert.deepEqual(geographicToGamePosition(origin, region.frame), { x: 0, y: 0 });
  const sourceCoordinate = { latitude: 7.2561764, longitude: 5.1933903 };
  const gamePosition = geographicToGamePosition(sourceCoordinate, region.frame);
  assert.ok(gamePosition.x < 0);
  assert.ok(gamePosition.y < 0);
  const roundTrip = gamePositionToGeographic(gamePosition, region.frame);
  assert.ok(Math.abs(roundTrip.latitude - sourceCoordinate.latitude) <= 0.0000001);
  assert.ok(Math.abs(roundTrip.longitude - sourceCoordinate.longitude) <= 0.0000001);
  assert.equal(geographicDistanceMeters(sourceCoordinate, sourceCoordinate), 0);

  const topLeft = coordinateToViewport(
    { latitude: region.viewport.bounds_wgs84.north, longitude: region.viewport.bounds_wgs84.west },
    region.viewport.bounds_wgs84,
    region.viewport,
  );
  assert.deepEqual(topLeft, { x: 0, y: 0 });
  const bottomRight = viewportToCoordinate(
    { x: region.viewport.width, y: region.viewport.height },
    region.viewport.bounds_wgs84,
    region.viewport,
  );
  assert.deepEqual(bottomRight, {
    latitude: region.viewport.bounds_wgs84.south,
    longitude: region.viewport.bounds_wgs84.east,
  });
});

test("500 m chunks are stable and form deterministic nearby interest windows", () => {
  const center = { latitude: 7.25, longitude: 5.2 };
  const firstId = chunkForCoordinate(center).id;
  assert.equal(firstId, "ng:500m:1142:1612");
  const sameLocationId = "ng:500m:1142:1612";
  const adjacentId = "ng:500m:1143:1612";
  const distantId = "ng:500m:1145:1612";
  assert.ok(chunksAreWithinRadius(firstId, sameLocationId, 1));
  assert.ok(chunksAreWithinRadius(firstId, adjacentId, 1));
  assert.equal(chunksAreWithinRadius(firstId, distantId, 1), false);
  assert.equal(chunksWithinRadius(firstId, 1).length, 9);
  assert.equal(chunksWithinRadius(firstId, 1)[0], "ng:500m:1141:1611");
  assert.equal(chunkForCoordinate(center).id, firstId);
});

test("geographic identity is validated and streaming filters bounded feature assets by chunk", async () => {
  const region = loadAkureSouthRegion();
  const location = geographicLocationFromCoordinate({ latitude: 7.25, longitude: 5.2 }, region);
  assert.equal(location.world_id, "nigeria-main");
  assert.equal(location.region_id, region.id);
  assert.equal(location.state_id, region.state_id);
  assert.equal(location.lga_id, region.lga_id);
  assert.ok(geographicLocationIsValid(location, region));
  assert.equal(geographicLocationIsValid({ ...location, chunk_id: "ng:500m:0:0" }, region), false);
  assert.throws(
    () => geographicLocationFromCoordinate({ latitude: 7.3, longitude: 5.2 }, region),
    /outside the selected region viewport/,
  );

  const mapLocation = geographicLocationForMapPosition({ x: 800, y: 450 }, region);
  assert.ok(geographicLocationIsValid(mapLocation, region));
  assert.equal(mapLocation.latitude, 7.25);
  assert.equal(mapLocation.longitude, 5.2);
  const features = geographicAssetsForChunks(region, new Set([location.chunk_id]));
  assert.ok(features.length > 0);
  assert.ok(features.every((feature) => feature.chunk_ids.includes(location.chunk_id)));
  assert.deepEqual(geographicAssetsForChunks(region, new Set()), []);
});

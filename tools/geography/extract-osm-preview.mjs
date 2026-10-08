#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const selectionPath = resolve(
  repoRoot,
  "game/data/geography/source/osm/akure-south-selection.json",
);
const outputPath = resolve(
  repoRoot,
  "game/data/geography/source/osm/akure-south-core.geojson",
);
const inputPath = process.argv[2];

if (!inputPath) {
  console.error(
    "Usage: node tools/geography/extract-osm-preview.mjs <upstream-kepler-preview.html>",
  );
  process.exitCode = 2;
} else {
  await extract(resolve(inputPath));
}

async function extract(previewPath) {
  const [html, selectionText] = await Promise.all([
    readFile(previewPath, "utf8"),
    readFile(selectionPath, "utf8"),
  ]);
  const selection = JSON.parse(selectionText);
  const embedded = readEmbeddedKeplerData(html);
  const clip = selection.clipBoundsWgs84;
  const isInsideClip = (position) =>
    position[0] >= clip.west && position[0] <= clip.east &&
    position[1] >= clip.south && position[1] <= clip.north;
  const featuresByLayer = new Map();

  for (const [sourceLayer, table] of Object.entries(embedded.data ?? {})) {
    if (!Object.hasOwn(selection.sourceLayerKinds, sourceLayer)) continue;
    const [osmIdIndex, nameIndex, geometryIndex] = table.columns.reduce(
      (indexes, column, index) => {
        if (column === "osmid") indexes[0] = index;
        if (column === "name") indexes[1] = index;
        if (column === "geometry") indexes[2] = index;
        return indexes;
      },
      [-1, -1, -1],
    );
    if (osmIdIndex < 0 || geometryIndex < 0) {
      throw new Error(`The ${sourceLayer} source table is missing osmid or geometry.`);
    }

    const candidates = [];
    for (const row of table.data) {
      const wkt = row[geometryIndex];
      if (typeof wkt !== "string") {
        throw new Error(`The ${sourceLayer} source contains a non-text geometry.`);
      }
      const geometry = parseWkt(wkt);
      const positions = flattenCoordinates(geometry.coordinates);
      if (positions.length === 0 || !positions.some(isInsideClip)) continue;

      const bounds = getBounds(positions);
      const anchor = [
        clamp((bounds.west + bounds.east) / 2, clip.west, clip.east),
        clamp((bounds.south + bounds.north) / 2, clip.south, clip.north),
      ];
      const rawName = nameIndex < 0 ? null : row[nameIndex];
      const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
      const osmId = String(row[osmIdIndex]);
      const stableGeometry = JSON.stringify(geometry);
      const geometryHash = createHash("sha256").update(stableGeometry).digest("hex");
      candidates.push({
        sourceLayer,
        osmId,
        name,
        geometry,
        geometryHash,
        cell: cellFor(anchor, selection.sampleGrid, clip),
        insideByCenter: isInsideClip(anchor),
      });
    }

    const selected = selectLayerFeatures(sourceLayer, candidates, selection.sampleGrid);
    featuresByLayer.set(sourceLayer, selected);
  }

  const allFeatures = [];
  for (const sourceLayer of Object.keys(selection.sourceLayerKinds).sort()) {
    const features = featuresByLayer.get(sourceLayer) ?? [];
    const idCounts = new Map();
    for (const feature of features) {
      const baseId = `osm:${sourceLayer}:${feature.osmId}`;
      idCounts.set(baseId, (idCounts.get(baseId) ?? 0) + 1);
    }
    for (const feature of features) {
      const baseId = `osm:${sourceLayer}:${feature.osmId}`;
      const id = idCounts.get(baseId) === 1
        ? baseId
        : `${baseId}:${feature.geometryHash.slice(0, 12)}`;
      allFeatures.push({
        type: "Feature",
        id,
        properties: {
          source_feature_id: id,
          osm_id: feature.osmId,
          source_layer: sourceLayer,
          ...(feature.name ? { name: feature.name } : {}),
        },
        geometry: feature.geometry,
      });
    }
  }

  allFeatures.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const featureCollection = {
    type: "FeatureCollection",
    name: selection.regionId,
    bbox: [clip.west, clip.south, clip.east, clip.north],
    features: allFeatures,
  };
  await writeFile(outputPath, `${JSON.stringify(featureCollection, null, 2)}\n`, "utf8");

  const counts = Object.fromEntries(
    [...featuresByLayer.entries()].map(([layer, features]) => [layer, features.length]),
  );
  console.info(`Wrote ${allFeatures.length} OSM features to ${outputPath}`);
  console.info(JSON.stringify(counts, null, 2));
}

function readEmbeddedKeplerData(html) {
  const marker = "window.__keplerglDataConfig = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("The HTML file does not contain a Kepler data config.");
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  if (jsonEnd < 0) throw new Error("The embedded Kepler data config is not terminated.");
  const parsed = JSON.parse(html.slice(jsonStart, jsonEnd));
  if (!parsed || typeof parsed !== "object" || !parsed.data || typeof parsed.data !== "object") {
    throw new Error("The embedded Kepler data config has no feature tables.");
  }
  return parsed;
}

function parseWkt(wkt) {
  const typeMatch = /^\s*([A-Z]+)\s*/u.exec(wkt);
  if (!typeMatch) throw new Error(`Unsupported WKT geometry: ${wkt.slice(0, 40)}`);
  const type = typeMatch[1];
  if (!new Set(["POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON"]).has(type)) {
    throw new Error(`Unsupported WKT geometry type ${type}.`);
  }

  let index = typeMatch[0].length;
  const skipSpace = () => {
    while (/\s/u.test(wkt[index] ?? "")) index += 1;
  };
  const parseValue = () => {
    skipSpace();
    if (wkt[index] !== "(") throw new Error(`Malformed WKT geometry ${type}.`);
    index += 1;
    const values = [];
    while (index < wkt.length) {
      skipSpace();
      if (wkt[index] === ")") {
        index += 1;
        return values;
      }
      if (wkt[index] === "(") {
        values.push(parseValue());
      } else {
        const start = index;
        while (index < wkt.length && wkt[index] !== "," && wkt[index] !== ")") index += 1;
        const ordinates = wkt
          .slice(start, index)
          .trim()
          .split(/\s+/u)
          .map(Number);
        if (ordinates.length < 2 || !ordinates.slice(0, 2).every(Number.isFinite)) {
          throw new Error(`Malformed coordinate in WKT geometry ${type}.`);
        }
        values.push([roundCoordinate(ordinates[0]), roundCoordinate(ordinates[1])]);
      }
      skipSpace();
      if (wkt[index] === ",") {
        index += 1;
        continue;
      }
      if (wkt[index] === ")") {
        index += 1;
        return values;
      }
      throw new Error(`Malformed WKT coordinate list for ${type}.`);
    }
    throw new Error(`Unclosed WKT geometry ${type}.`);
  };

  let coordinates = parseValue();
  skipSpace();
  if (index !== wkt.length) throw new Error(`Unexpected text after WKT geometry ${type}.`);
  if (type === "POINT") coordinates = coordinates[0];
  if (type === "MULTIPOINT") {
    coordinates = coordinates.map((point) => Array.isArray(point[0]) ? point[0] : point);
  }
  return { type: geometryType(type), coordinates };
}

function geometryType(wktType) {
  const types = {
    POINT: "Point",
    LINESTRING: "LineString",
    POLYGON: "Polygon",
    MULTIPOINT: "MultiPoint",
    MULTILINESTRING: "MultiLineString",
    MULTIPOLYGON: "MultiPolygon",
  };
  return types[wktType];
}

function flattenCoordinates(value, output = []) {
  if (Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const child of value) flattenCoordinates(child, output);
  }
  return output;
}

function getBounds(positions) {
  return {
    west: Math.min(...positions.map((position) => position[0])),
    south: Math.min(...positions.map((position) => position[1])),
    east: Math.max(...positions.map((position) => position[0])),
    north: Math.max(...positions.map((position) => position[1])),
  };
}

function cellFor(position, grid, clip) {
  const column = Math.min(
    grid.columns - 1,
    Math.max(0, Math.floor(((position[0] - clip.west) / (clip.east - clip.west)) * grid.columns)),
  );
  const row = Math.min(
    grid.rows - 1,
    Math.max(0, Math.floor(((position[1] - clip.south) / (clip.north - clip.south)) * grid.rows)),
  );
  return `${column}:${row}`;
}

function selectLayerFeatures(sourceLayer, candidates, grid) {
  if (sourceLayer !== "roads" && sourceLayer !== "buildings") {
    return candidates.filter((candidate) => candidate.insideByCenter || sourceLayer === "roads");
  }
  const maxPerCell = sourceLayer === "roads"
    ? grid.maxRoadFeaturesPerCell
    : grid.maxBuildingFeaturesPerCell;
  const groups = new Map();
  for (const candidate of candidates) {
    if (sourceLayer === "buildings" && !candidate.insideByCenter) continue;
    const group = groups.get(candidate.cell) ?? [];
    group.push(candidate);
    groups.set(candidate.cell, group);
  }
  const selected = [];
  for (const group of groups.values()) {
    group.sort((left, right) => {
      if (grid.preferNamedFeatures && Boolean(left.name) !== Boolean(right.name)) {
        return left.name ? -1 : 1;
      }
      return stableKey(left).localeCompare(stableKey(right));
    });
    selected.push(...group.slice(0, maxPerCell));
  }
  return selected;
}

function stableKey(feature) {
  return createHash("sha256")
    .update(`${feature.osmId}\u0000${feature.geometryHash}`)
    .digest("hex");
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(7));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

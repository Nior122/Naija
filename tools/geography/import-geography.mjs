import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGeographyFromSources } from "../../services/world-api/dist/geography/importer.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(repositoryRoot, "game/data/geography/source");
const outputRoot = path.join(repositoryRoot, "game/data/geography/processed");
const checkOnly = process.argv.includes("--check");

const sourceDefinitions = [
  {
    path: "admin/nigerian-lgas.json",
    provider: "xosasx",
    source_url: "https://github.com/xosasx/nigerian-local-government-areas",
    source_commit: "115524ab9a1c66109c3c6daea9577b0ee7fb1f76",
    repository_license: "MIT",
    data_lineage: "README acknowledges the dr5hn countries-states-cities database; conservatively retain its ODbL-1.0 database notice.",
    upstream_url: "https://github.com/dr5hn/countries-states-cities-database",
    data_license: "ODbL-1.0 (conservative upstream lineage treatment)",
    attribution: "LGA source derived from the pinned xosasx repository; upstream dr5hn attribution and ODbL notice retained.",
  },
  {
    path: "admin/akure-south-wards.json",
    provider: "temikeezy",
    source_url: "https://github.com/temikeezy/nigeria-geojson-data",
    source_commit: "3cd13e6088bf72b0873d7d6fa7cf4cf0294ad9a6",
    repository_license: "MIT",
    data_lineage: "Filtered 11-row Akure South ward reference-point subset; coordinate role is unspecified by the source.",
    data_license: "MIT",
    attribution: "temikeezy/nigeria-geojson-data",
  },
  {
    path: "admin/ondo-akure-settlement.json",
    provider: "CodeLeom",
    source_url: "https://github.com/CodeLeom/nigeria-state-city-lga",
    source_commit: "f1c533729a702ff42fb711403bdd0338ef98511e",
    repository_license: "MIT",
    data_lineage: "Ondo capital/town name subset only; no settlement coordinate or boundary is supplied.",
    data_license: "MIT",
    attribution: "CodeLeom/nigeria-state-city-lga",
  },
  {
    path: "osm/akure-south-core.geojson",
    provider: "Mapkathon2026-UseOSM/lga-osm-extractor and OpenStreetMap contributors",
    source_url: "https://github.com/Mapkathon2026-UseOSM/lga-osm-extractor",
    source_commit: "414af2369c70ee5d5d3800cbed33a4bcf9370117",
    source_path: "visuals/akure_south_preview.html",
    source_git_blob_sha1: "78a9e1796376ae8bfc432fb763c49c9b27ad4ed1",
    source_file_bytes: 36946166,
    source_file_sha256: "07f65309781fe15a4d35c115dff2f8e7926eed7eb957e4afae04c820ec86ba92",
    source_snapshot_utc: "2026-07-31T12:26:31.185714Z",
    crs_review: "Preview WKT has no embedded CRS field; axis order was checked against the declared Akure viewport, Nigeria coordinate ranges, and named Akure features plus the pinned Ondo/Akure South reference point.",
    repository_license: "MIT (extractor code only; not the map data)",
    data_license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    license_url: "https://www.openstreetmap.org/copyright",
    data_lineage: "Bounded WGS84 feature sample extracted from an attributed preview; source HTML does not retain original OSM tags.",
  },
  {
    path: "osm/akure-south-selection.json",
    provider: "Naija geography import configuration",
    source_url: null,
    source_commit: null,
    repository_license: "Project source configuration",
    data_license: "Not a geographic dataset",
    attribution: "Viewport, layer mapping, caps, and source snapshot declaration maintained in this repository.",
  },
];

async function readJson(relativePath) {
  const absolutePath = path.join(sourceRoot, relativePath);
  const sourceBytes = await readFile(absolutePath);
  return {
    json: JSON.parse(sourceBytes.toString("utf8")),
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  };
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const loadedSources = new Map();
for (const definition of sourceDefinitions) {
  loadedSources.set(definition.path, await readJson(definition.path));
}

const importResult = buildGeographyFromSources({
  lgas: loadedSources.get("admin/nigerian-lgas.json").json,
  wards: loadedSources.get("admin/akure-south-wards.json").json,
  settlement: loadedSources.get("admin/ondo-akure-settlement.json").json,
  selection: loadedSources.get("osm/akure-south-selection.json").json,
  osm: loadedSources.get("osm/akure-south-core.geojson").json,
});

const dataOutputs = new Map([
  ["nigeria-admin.json", prettyJson(importResult.admin)],
  ["akure-south-core.json", prettyJson(importResult.region)],
]);
const manifestSources = sourceDefinitions.map((definition) => ({
  ...definition,
  sha256: loadedSources.get(definition.path).sha256,
}));
const generatedManifest = {
  schema_version: 1,
  pipeline: {
    command: "npm run geography:import",
    importer: "services/world-api/src/geography/importer.ts",
    pipeline_version: 1,
    deterministic: true,
    check_command: "npm run geography:check",
  },
  output_files: [...dataOutputs.entries()].map(([file, content]) => ({
    file,
    sha256: createHash("sha256").update(content).digest("hex"),
  })),
  counts: {
    countries: 1,
    states_and_fct: importResult.admin.states.length,
    lgas: importResult.admin.lgas.length,
    wards_in_sample_lga: importResult.region.wards.length,
    region_features: importResult.region.features.length,
    feature_kinds: importResult.region.feature_counts,
    geographic_chunks: importResult.region.streaming.content_chunk_ids.length,
  },
  coordinate_contract: {
    input_crs: "WGS84 longitude/latitude (GeoJSON OGC:CRS84 axis order)",
    storage_precision_degrees: 7,
    local_projection: "local-equirectangular-v1",
    local_origin_wgs84: importResult.region.frame.origin,
    local_axes: "x east, y south",
    game_units_per_meter: importResult.region.frame.game_units_per_meter,
    local_position_precision_meters: importResult.region.frame.precision_meters,
    chunk_grid: "Nigeria-wide equirectangular grid centered at 9 degrees latitude; stable 500 m cells",
    region_viewport_is_boundary: false,
  },
  data_terms:
    "Composite output. OSM-derived geography is ODbL-1.0 with OpenStreetMap attribution. LGA data retains conservative upstream ODbL lineage and its pinned MIT repository notice. MIT source notices for ward and settlement-name subsets remain component-specific; no one source license supersedes the others.",
  sources: manifestSources,
  validation: {
    passed: true,
    rules: [
      "37 unique state/FCT codes and 774 unique source LGA records; stable canonical IDs do not depend on optional Wikidata identifiers.",
      "Duplicate optional Wikidata identifiers are reported and omitted from normalized external IDs.",
      "WGS84 coordinate ranges and broad Nigeria bounds are validated; source administrative points are not relabeled as boundaries or centroids.",
      "The Akure South viewport is a bounded sample, not an administrative boundary; each retained OSM geometry intersects it and remains within a 0.05 degree safety margin.",
      "GeoJSON geometry structure, ring closure, OSM source IDs/layers, unique feature IDs, per-feature chunk coverage, and output provenance are validated.",
    ],
  },
};
const manifestContent = prettyJson(generatedManifest);
const allOutputs = new Map([...dataOutputs, ["import-manifest.json", manifestContent]]);

if (checkOnly) {
  const failures = [];
  for (const [file, expected] of allOutputs) {
    let actual;
    try {
      actual = await readFile(path.join(outputRoot, file), "utf8");
    } catch {
      failures.push(`${file} is missing; run npm run geography:import.`);
      continue;
    }
    if (actual !== expected) failures.push(`${file} is stale; run npm run geography:import.`);
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Geography import is reproducible: ${allOutputs.size} processed files match pinned sources.`);
  }
} else {
  await mkdir(outputRoot, { recursive: true });
  for (const [file, content] of allOutputs) {
    await writeFile(path.join(outputRoot, file), content, "utf8");
  }
  console.log(
    `Imported ${importResult.admin.states.length} states/FCT, ${importResult.admin.lgas.length} LGAs, ` +
      `${importResult.region.wards.length} wards, ${importResult.region.features.length} Akure South sample features.`,
  );
  console.log(`Wrote ${allOutputs.size} deterministic files to game/data/geography/processed/.`);
}

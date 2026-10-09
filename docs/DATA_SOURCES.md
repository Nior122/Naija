# Geography Data Sources, Licenses and Provenance

## Scope and redistribution guardrails

Stage 3 uses a small national administrative registry and one bounded map-data sample. It does **not** download or commit country-scale OSM data, official national boundary polygons, commercial map tiles, or the 36 MB upstream preview HTML. Raw/pinned subset artifacts are kept under `game/data/geography/source/`; normalized outputs and their deterministic SHA-256/source manifest are under `game/data/geography/processed/`.

The compiled files combine components with different source terms. Do not claim that one license overrides another. OSM-derived features are attributed to OpenStreetMap contributors and retain ODbL-1.0 terms. The LGA catalog conservatively preserves the acknowledged upstream ODbL lineage as well as the pinned repository's MIT notice. Ward/settlement-name records preserve their own MIT-source notices. The manifest describes each input and its SHA-256; license files, attribution and caveats are part of the deliverable.

This documentation records inspected repository declarations and the exact pinned snapshots used. It is an engineering provenance record, not legal advice. Recheck upstream terms/attribution before public release, redistribution outside the repository, or a new extraction.

## Pinned source ledger

| Component used | Pinned source and commit | Terms / notices retained | What is used and caveats |
|---|---|---|---|
| All-Nigeria LGA names/codes/reference points | [`xosasx/nigerian-local-government-areas`](https://github.com/xosasx/nigerian-local-government-areas/tree/115524ab9a1c66109c3c6daea9577b0ee7fb1f76), commit `115524ab9a1c66109c3c6daea9577b0ee7fb1f76`; pinned input `game/data/geography/source/admin/nigerian-lgas.json` | The pinned repository declares MIT; its README acknowledges [`dr5hn/countries-states-cities-database`](https://github.com/dr5hn/countries-states-cities-database), whose GitHub repository metadata declares ODbL-1.0. The exact upstream data commit was not pinned with this subset. For the derived LGA database, retain the conservative ODbL lineage/attribution as well as `game/data/geography/source/licenses/xosasx-nigerian-local-government-areas-MIT.txt`. | 774 rows across 37 state/FCT codes. Numeric row IDs are retained only as `source_record_id`; canonical IDs use normalized state code/name. Coordinates are published reference points, not verified boundary geometry or centroids. Three duplicated optional Wikidata IDs are omitted from normalized identifiers and listed as warnings. |
| Akure South ward subset | [`temikeezy/nigeria-geojson-data`](https://github.com/temikeezy/nigeria-geojson-data/tree/3cd13e6088bf72b0873d7d6fa7cf4cf0294ad9a6), commit `3cd13e6088bf72b0873d7d6fa7cf4cf0294ad9a6`; pinned input `game/data/geography/source/admin/akure-south-wards.json` | Repository declares MIT; notice retained at `game/data/geography/source/licenses/temikeezy-nigeria-geojson-data-MIT.txt`. | Filtered 11-row Ondo/Akure South subset. The source does not document whether its coordinates are points, centroids or another representative. They are retained as `published_reference_point`; no ward boundary is inferred. |
| Ondo capital/town name | [`CodeLeom/nigeria-state-city-lga`](https://github.com/CodeLeom/nigeria-state-city-lga/tree/f1c533729a702ff42fb711403bdd0338ef98511e), commit `f1c533729a702ff42fb711403bdd0338ef98511e`; pinned subset `game/data/geography/source/admin/ondo-akure-settlement.json` | Repository declares MIT; notice retained at `game/data/geography/source/licenses/CodeLeom-nigeria-state-city-lga-MIT.txt`. | Confirms the name Akure as an Ondo capital/town. It supplies no authoritative settlement coordinate or boundary. The sample's Akure association with Akure South is a prototype selection note, not an assertion that the town is wholly within that LGA. |
| OpenStreetMap preview features | [`Mapkathon2026-UseOSM/lga-osm-extractor`](https://github.com/Mapkathon2026-UseOSM/lga-osm-extractor/tree/414af2369c70ee5d5d3800cbed33a4bcf9370117), commit `414af2369c70ee5d5d3800cbed33a4bcf9370117`; source HTML `visuals/akure_south_preview.html` (Git blob SHA-1 `78a9e1796376ae8bfc432fb763c49c9b27ad4ed1`; 36,946,166 bytes; SHA-256 `07f65309781fe15a4d35c115dff2f8e7926eed7eb957e4afae04c820ec86ba92`); tracked derived subset `game/data/geography/source/osm/akure-south-core.geojson` | The extractor **code** declares MIT (`game/data/geography/source/licenses/Mapkathon-lga-osm-extractor-MIT.txt`). Its README attributes the extracted map data to OpenStreetMap contributors under ODbL. The code license does not replace the OSM data license. Keep ODbL-1.0/attribution: [`OpenStreetMap copyright and license`](https://www.openstreetmap.org/copyright); official [ODbL 1.0 text](https://opendatacommons.org/licenses/odbl/1-0/). | The preview reports WKT, OSM IDs, names where present and source layer, but not original OSM tags. The pinned preview is associated with data snapshot `2026-07-31T12:26:31.185714Z`. A deterministic viewport/grid selection retains 200 features only: roads 72, buildings 108, waterways 13, land use 2, health facilities 3, schools 2. It is a partial sample, not a complete Akure South extract. |

The preview HTML is deliberately not committed. Its exact repository path, commit, Git blob ID, file size and SHA-256 are recorded above and in `game/data/geography/source/osm/akure-south-selection.json` / `game/data/geography/processed/import-manifest.json`. The committed GeoJSON is the bounded source artifact needed for normal builds/tests.

## OSM attribution and CRS review

Include this attribution wherever the OSM-derived preview/data is redistributed or displayed:

> © OpenStreetMap contributors. OpenStreetMap data is available under the Open Database License (ODbL) 1.0. See <https://www.openstreetmap.org/copyright>.

The in-game preview displays `© OpenStreetMap contributors · ODbL 1.0` and explicitly labels the content a viewport sample, not an administrative boundary. The processed region also carries the attribution text, ODbL identifier and copyright URL. The OSM-derived database must continue to meet ODbL attribution/share-alike requirements when distributed; the extractor's MIT license is for software only.

**CRS/axis-order finding and limit:** the upstream embedded Kepler table exposes WKT coordinates but no explicit CRS property in the feature table. The source selection is therefore explicit about the assumption `OGC:CRS84`, `x=longitude`, `y=latitude`. This was cross-checked against the declared Akure viewport, Nigeria coordinate ranges, the pinned Ondo/Akure South reference coordinate, and named Akure features/roads. In the retained features, coordinates are around longitude 5.16–5.22° and latitude 7.23–7.29°, consistent with the selected Akure area; swapping axes would fail the selected viewport validation. This is a practical source-local validation, **not an authoritative projection statement embedded in the upstream HTML**. If a future upstream artifact changes coordinate metadata/axis order, the importer must be reviewed rather than reusing this assumption silently.

The importer validates the CRS declaration, finite/ranged coordinates, broad Nigeria placement, that every selected OSM geometry intersects the declared viewport and that retained geometries remain within a conservative 0.05° safety margin. It does not independently re-query OSM, verify every feature's live status, restore missing OSM tags, or turn the viewport into a legal LGA boundary.

## Region selection and known coverage

- Region key: `ng:region:ondo:akure-south-core`; state `ng:state:on`; sample LGA `ng:lga:on:akure-south`; shared `world_id` is still `nigeria-main`.
- Viewport: west `5.188°`, south `7.238°`, east `5.212°`, north `7.262°` in WGS84.
- The viewport was chosen as a small bounded, reproducible feature selection. It is **not** an Akure South legal/administrative boundary, a settlement boundary, or a representative coverage of the full LGA.
- Road geometry is display data, not a complete road graph. Building footprints are not a complete building register and do not imply interior/ownership/use. School/health features are sparse mapped POIs. Waterway/land-use features are contextual geometry only.
- The 11 ward coordinates fall across the broader LGA, are reference points with unknown semantics, and are not snapped to or inferred as district polygons. `Ijomu/Obanla` is used for a prototype spawn/reference because its published point falls inside the selected viewport; it is not an official centroid.
- The settlement-name record confirms Akure as a capital/town but no coordinate. No settlement coordinate is invented; processed `settlement.coordinate` is `null`.
- Port Harcourt/Rivers was preferred but no suitable bounded source with sufficiently clear terms/provenance was available. A commercial fuel-locator dataset had unclear terms/provenance; an advertised Rivers GeoJSON was absent; no suitable Port Harcourt OSM preview/extract was found. Akure South is the documented fallback, not a claim that Port Harcourt has no available data generally.
- No full national road/building geometry, map tile, terrain raster, or full-country OSM download is included. Terrain/environment/transport/weather concepts are extension points only.

## Deterministic processing and artifact separation

```text
game/data/geography/source/       pinned input subsets, viewport config, license notices
        │
        ├─ optional preview re-extraction:
        │  node tools/geography/extract-osm-preview.mjs <pinned-preview.html>
        │
        └─ canonical import/validation:
           npm run geography:import
                  │
                  ▼
game/data/geography/processed/    nigeria-admin.json
                                  akure-south-core.json
                                  import-manifest.json
```

- `tools/geography/extract-osm-preview.mjs` parses the pinned Kepler HTML/WKT and deterministically applies the documented viewport and layer/grid caps. It writes a small FeatureCollection retaining selected geometry, source layer, OSM ID and available name; it does not retain `raw_tags` because the upstream preview does not contain them.
- `services/world-api/src/geography/importer.ts` validates input and builds canonical admin records, reference points, features, stable chunk IDs and feature counts. Feature chunk indexes conservatively fill the axis-aligned bounds of each geometry; they can include cells not physically touched, favoring no missed edge-spanning content over an exact per-cell intersection test. Unknown/unapproved layers, malformed coordinates/geometries, duplicate IDs, unsupported CRS, missing source provenance or inconsistent sample metadata fail the import.
- `tools/geography/import-geography.mjs` hashes all tracked source files and deterministic output, records upstream repository/commit, OSM snapshot, component license statements, coordinate assumptions and validation rules. No volatile generation timestamp is included.
- `npm run geography:check` rebuilds expected values in memory and fails if the committed processed outputs do not byte-match current pinned inputs. The World API tests independently rebuild the importer result and compare processed catalogs.
- Keep original inputs, processed catalogs, import code and gameplay actions separate. Do not edit generated processed JSON by hand; change source/config/importer, regenerate, review manifest hashes/counts and source terms.

## License notices in this repository

Four pinned MIT license texts are retained under `game/data/geography/source/licenses/`, each for its source repository/code notice. There is no claim those texts license OSM map data. ODbL terms/attribution are linked above and stated in the source selection, processed region and import manifest. If release packaging excludes `docs/DATA_SOURCES.md` or the processed manifest, include an equivalent human-readable OSM attribution/license notice with the geographic data.

Before expanding or publishing: verify current upstream repository/file and license state; preserve every contributor/license/attribution notice; re-check the OSM-derived database obligations; confirm the coordinate declaration with the source artifact; inspect any new tags/geometry; update source hashes, counts, sample caveats, tests and this document. Do not replace missing metadata with guessed administrative boundaries or coordinates.

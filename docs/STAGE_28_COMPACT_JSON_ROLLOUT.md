# Stage 28 — Compact JSON for saved worlds: rollout status and validation

**Status: BLOCKED for rollout to existing saved-world data.** The code is on the branch as an opt-in setting. Nothing in this repository has converted, or approved converting, any saved world. Stage 28 remains IN PROGRESS.

## 1. What changed and what is still blocked

| Item | State |
|---|---|
| Compact writer (`WorldStore`, option `format: "compact"`) | Implemented, tested (`test/world-state-format.test.mjs`). |
| Default save format | **`pretty`** (the format used before). A default save does not change an existing file's layout. |
| Operator setting | `NAIJA_WORLD_STATE_FORMAT=pretty` (default) or `compact`. File backend only. |
| Loading | Both layouts load with the same validation. Load never rewrites a file. |
| PostgreSQL | Not affected by this setting. The PostgreSQL store already writes compact JSON (`JSON.stringify(state)` in `src/database/world-store.ts`). That is existing behaviour and is not changed here. |
| Rollout to existing saved-world data | **BLOCKED.** Requires the validation in section 4 and explicit approval. |
| Saved-world corpus (284 files) | **NOT LOCATED** in this environment (see `STAGE_28_CAPACITY.md`, and the corpus search record). **Not revalidated.** |

## 2. Activation analysis (read-only, before this change)

- `WorldStore.writeSnapshot` always called `JSON.stringify(state)` (compact). There was no format option.
- Every save of a file-backed world rewrote the whole file in compact form. The constructor only validated the file and did not rewrite it, so the **first save after upgrade converted an existing pretty file** to compact.
- The file backend is refused in production (`src/persistence/open.ts`, `resolvePersistenceBackend`). The conversion therefore affected development and test worlds only, and would have affected any operator who ran the file backend.

**Guard added (Decision 1).** The default is now `pretty`, so an upgraded server does not convert an existing file on its first save. Tests check that: a default save writes pretty JSON and keeps the content; compact is written only when set explicitly; an unknown format is rejected. (`test/world-state-format.test.mjs`, `test/world-state-format-config.test.mjs`: 9 of 9 pass.)

## 3. Measured effect (real saves, production 16 MiB limit, file backend)

| Run | Format | Identities created before the first refused save | Final bytes | Note |
|---|---|---|---|---|
| default-cap run 1 | compact | 1,059 | 16,774,334 | `docs/evidence/stage28-capacity/default-cap-compact-run1.json` |
| default-cap run 2 | compact | 1,069 | 16,776,341 | `docs/evidence/stage28-capacity/default-cap-compact-run2.json` |
| default-cap run 3 | compact | 1,047 | 16,775,869 | `docs/evidence/stage28-capacity/default-cap-compact-run3.json` |
| default-cap | pretty | see `STAGE_28_CAPACITY.md`, section 5.2 | | Measured after the guard, with `--format pretty` |

Compact output is smaller, so more identities fit before the 16 MiB limit. The limit is unchanged. Compact does **not** remove the capacity limit, and it does not make 2,500 or more identities possible. See `STAGE_28_CAPACITY.md`.

## 4. Validation required before any rollout to existing data

The tool is `services/world-api/scripts/saved-world-format-check.mjs`. It never writes to the source directory. It loads each `*.json` copy in a private temp directory, saves it in compact form to a second temp copy, reloads both, and compares the loaded states. Output is a JSON report with file names, sizes, hashes, collection counts, and differing paths (never values). It re-checks each original's SHA-256 at the end.

**Scope of a pass:** it shows that the listed files load, and that their compact round-trip keeps the loaded state. It does **not** prove historical integrity of player data, and it says nothing about production or PostgreSQL.

Required steps, in order. Each must be recorded in the rollout ticket:

1. **Locate the corpus.** The saved-world files must be available as read-only copies. Record the source path, file count, and a manifest of SHA-256 hashes made **before** any check. If the corpus cannot be located, stop: rollout stays blocked.
2. **Keep originals read-only.** Check that the directory is not writable by the check, and do not run any server against the originals.
3. **Build and run the check** (from `services/world-api`):
   ```
   npm run build
   node scripts/saved-world-format-check.mjs <copy-directory> --out <report-outside-that-directory>.json
   ```
   Pass criteria: exit code 0; `failed` is 0; every file has `status: "pass"` and `sourceUnchanged: true`; `fileCount` equals the number of files in the manifest.
4. **Review the report.** Any `load-failed`, `compact-roundtrip-differs`, or `collection-counts-differ` blocks rollout. Each discrepancy is investigated and reported; nothing is repaired silently.
5. **Size check.** Every compact output must be under 16 MiB (the report gives `compactBytes`). Record the largest file.
6. **Start on a copy only.** Copy the chosen file, start the server with `NAIJA_WORLD_STATE_FORMAT=compact` and a temporary data path (never the live file), create one identity, and confirm the file reloads with the new identity present.
7. **Re-check originals.** Compare the manifest hashes again. They must be unchanged.
8. **Written approval** from the owner of the saved data, naming the files and the report. Until then, do not set `NAIJA_WORLD_STATE_FORMAT=compact` on any environment that holds real saved worlds.

**Rollback.** A compact file is still valid for a server running the default `pretty` setting, because loading accepts both layouts. To roll back, set `NAIJA_WORLD_STATE_FORMAT` back to `pretty`. The next save rewrites the file in pretty form. Keep the pre-rollout copies until the rollback window closes.

## 5. Tests and evidence

| Check | Result |
|---|---|
| `test/world-state-format.test.mjs` (format, rollout guard) | 6 of 6 pass |
| `test/world-state-format-config.test.mjs` (environment setting) | 3 of 3 pass |
| `test/saved-world-format-check.test.mjs` (tool self-test) | 4 of 4 pass. **These use generated files and are not corpus evidence.** |
| Corpus check (284 files) | **NOT RUN.** Corpus not located. |

## 6. Limits (keep with every claim)

- No historical saved-world corpus has been validated.
- No production or PostgreSQL behaviour has been measured for compact output.
- The round-trip check compares loaded state. It does not compare bytes, and it does not check game behaviour after load.
- Stage 28 remains IN PROGRESS. Production readiness is not claimed.

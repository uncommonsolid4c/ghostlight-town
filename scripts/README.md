# Deploy Staging & Live Health Scripts (`scripts/`)

Local static-bundle staging and read-only live-site verification scripts for
Ghostlight Town. Neither script deploys to the homelab or mutates live state.

## Shipped files

| File | Role |
| --- | --- |
| `stage-deploy.mjs` | Slice 28 static deploy staging script: stages `town-3d/` (default bundle) or `staging-polyfork` under `<out>/ghostlight-town/` with a sha256 `MANIFEST.json`; `--verify <dir>` re-checks a staged directory (read-only). |
| `check-live.mjs` | Slices 34 & 100 read-only live-site health check: verifies `<base>/ghostlight-town/` against the selected local bundle (`staging-polyfork` by default, or `town-3d` as fallback). |

Test suites (3, all registered in [`../run-tests.mjs`](../run-tests.mjs)):
`test-check-live.mjs`, `test-stage-deploy.mjs`, `test-readme.mjs`.

## `stage-deploy.mjs` (Slice 28)

Stages the static 3D tree into `<out>/ghostlight-town/` and writes
`MANIFEST.json` with per-file `sha256` hashes and byte counts. Local file
operations only — never touches the homelab, never bumps `?v=` in
`index.html`, and never stages `town-api/` or `town-npc/`.

```sh
node scripts/stage-deploy.mjs [--bundle <name>] [--out <dir>] [--root <dir>]
node scripts/stage-deploy.mjs --verify <dir> [--root <dir>]
```

- **Bundles:** `town-3d` (default) or `staging-polyfork`.
- **Target safety:** defaults `--out` to `<root>/staging`, and refuses to stage
  into or verify `<root>` itself or inside `town-3d/`, `town-api/`,
  `town-npc/`, or `staging-polyfork/`.
- **`--verify <dir>`:** read-only check against `<dir>/MANIFEST.json` (for
  example `<out>/ghostlight-town`); checks `sha256` of all manifest files and
  rejects missing, mismatched, or extra files, symlinks, and `town_js_v` /
  `staging_js_v` drift.
- **`EXCLUDED_FILES` rule:** excludes `town-3d/models/pine.glb` (`models/pine.glb`,
  2.2 MB, local-only, deliberately never committed or shipped; procedural trees
  stay). Also excludes `gazette/*.mjs` build tools in `town-3d/`, `test-*.mjs`
  and `README.md` in `staging-polyfork/`, and blocks secret-like filenames or
  contents.
- **Current staging facts:** staging bundle `staging-polyfork` stages **195
  files** with `staging_js_v` **41** (verified with `--bundle staging-polyfork`
  and `--verify`).

## `check-live.mjs` (Slices 34, 100)

Read-only live-site health check against `<base>/ghostlight-town/` and
`<api-base>/api/town/state`.

```sh
node scripts/check-live.mjs [--bundle <name>] [--base <url>] [--root <dir>] [--api-base <url>] [--require-api]
```

- **Defaults:** `--base https://milo.4167360.xyz`, `--bundle staging-polyfork`,
  `--api-base` defaults to `--base`, `--root` defaults to repo root.
- **Checks performed:**
  - HTTP 200 for every expected file in the selected bundle.
  - `glTF` 4-byte magic header on `.glb` models.
  - `staging.js?v=N` / `town.js?v=N` parity between repo `index.html` and live
    `index.html`.
  - Required bundle JS markers (`PROP_PLACEMENTS`, `buildConceptBandstand`,
    `SEED_WANDER_CONFIG`, `newsstand_papers_shelf` for `town-3d`;
    `applyStagingState`, `liveStore`, `buildConceptBandstand`,
    `concept-bandstand.js` for `staging-polyfork`).
  - `gazette/latest.json` parses cleanly and its `issue-*.html` target returns
    HTTP 200.
  - Informational check of `<api-base>/api/town/state`; pass `--require-api` to
    make a non-200 API response fail the run.

## Shared helpers

`check-live.mjs` imports `collectSourceFiles` and `listStagedFiles` from
`stage-deploy.mjs` so both scripts resolve the exact same file list for each
bundle (`stage-deploy.mjs` also exports `EXCLUDED_FILES`,
`collectSourceFilesFromTown3d`, and `collectSourceFilesFromStagingPolyfork`;
`check-live.mjs` exports `getExpectedFiles`).

## Honest limits

- **Staging is not deploying:** `stage-deploy.mjs` prepares and verifies a local
  staging directory only; deploying to the homelab is Milo's call in a
  foreground turn.
- **`check-live.mjs` is read-only:** it reads and reports on the live site and
  cannot fix or mutate it.

See [`../town-3d/README.md`](../town-3d/README.md),
[`../staging-polyfork/README.md`](../staging-polyfork/README.md), and
[`../PLAN.md`](../PLAN.md) §8 for bundle details and history.

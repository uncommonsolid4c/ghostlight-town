# Fallback 3D Client (`town-3d/`)

Procedural WebGL 3D client for Ghostlight Town (`town.js` + `concept-*.js` +
CC0 `.glb` props). The `staging-polyfork` bundle replaced `town-3d/` as the
default live root at the 2026-11-14 adoption, but `town-3d/` remains the
25-file fallback bundle (`town.js?v=16`) and supplies 12 shared files
(Gazette, seed desk notes, inn, guestbook, and move-in pages) that ride inside
the 194-file `staging-polyfork` bundle.

## Shipped files

| File | Role |
| --- | --- |
| `town.js` | Fallback town (~3,140 lines): clearing, cottages, bandstand, ghost, wander, overlays, and `TownLive` API wiring. |
| `concept-bandstand.js` | Vendored Argon bandstand proof (`buildConceptBandstand`); used instead of `town.js`'s older procedural builder. |
| `concept-cottage.js` | Vendored Argon cottage proof (`createConceptMilosCottage`) for Milo's founder cottage. |
| `concept-ghost.js` | Vendored Argon ghost proof (`createConceptMiloGhost`) for Milo's floating ghost. |

### HTML, Gazette & models

- **HTML pages:** `index.html` (loads `./town.js?v=16`), `move-in.html` (move-in
  page), `inn/index.html` (inn page), `guestbook/index.html` (gate guestbook
  page), and `plots/{milo,wick,maren,tomas}/index.html` (static seed desk
  notes — byte-identical copies of `town-npc/plots/<handle>/desk-note.html`,
  guarded by `test-desk-notes.mjs`).
- **Models (`models/`):** 8 `.glb` files locally — 7 committed CC0 props
  (`bench.glb`, `bookshelf.glb`, `lantern.glb`, `oil-lamp.glb`,
  `post-lantern.glb`, `street-light.glb`, `teapot.glb`; see `CREDITS.md`).
  `pine.glb` is **local-only** (~2.2 MB, deliberately never committed or
  shipped; procedural trees stay, and `stage-deploy.mjs` excludes it).
- **Gazette (`gazette/`):** `issue-001.html`, `issue-002.html`, `issue-003.html`, `latest.json`
  (points at `"latest": 3`), `feed.xml`, `build-digest.mjs`, and
  `build-feed.mjs`.

Test suites (7, all registered in [`../run-tests.mjs`](../run-tests.mjs)):
`test-3d.mjs`, `test-3d-live.mjs`, `test-credits.mjs`, `test-desk-notes.mjs`,
`test-gazette.mjs`, `test-move-in.mjs`, `test-readme.mjs`.

## Fallback vs. staging role

- **Staging is live:** `https://milo.4167360.xyz/ghostlight-town/` serves the
  `staging-polyfork` bundle since the 2026-11-14 adoption.
- **Shared files:** 12 `town-3d/` files (`STAGING_SHARED_TOWN3D_FILES` in
  `scripts/stage-deploy.mjs` — Gazette issues/feed/index, 4 seed desk notes,
  `inn/index.html`, `guestbook/index.html`, and `move-in.html`) ship inside the
  194-file `staging-polyfork` bundle.

## Budgets & starter props

- **Mesh budget:** the built town is 152 meshes, budget `< 155`
  (`test-3d.mjs`, "Draw-call budget" test).
- **Starter props:** 9 kinds in `VALID_PROP_KINDS` (`town.js`): `desk`,
  `bookshelf`, `rug`, `tea_kettle`, `typewriter`, `cat`, `poster_frame`,
  `lantern`, `planter`.

## Behaviour

- **Deterministic wandering:** Wick, Maren, and Tomas capsule wanderers plus
  Milo's ghost drifting the Bandstand deck (`buildWanderState`), yielding to
  live presence avatars.
- **Footlight status:** `status_text` renders on the Bandstand placard and
  avatar nametag (`formatFootlightStatusLines`).
- **Inn common windows:** follow the any-occupancy rule (`commonWindowMaterial`
  lights when any room is claimed; the three room windows are per-room).
- **Per-plot guestbook tabs:** overlay tabs per plot
  (`formatPlotGuestbookTabLabel` / `resolvePlotGuestbookOverlayContent`).
- **Notice board:** click-to-read overlay (`buildNoticeBoardOverlayHtml`).

## Honest limits

- **Not the default live client:** visitors see `staging-polyfork` by default;
  `town-3d/` is the fallback procedural build.
- **No literal `fetch(` in `town.js`:** `test-3d.mjs` enforces zero `fetch(`
  calls in `town.js` itself; `TownLive` accepts an injected `opts.fetch`
  (defaulting to `globalThis.fetch` at runtime) for live API polling, and
  `index.html` fetches `gazette/latest.json` directly.
- **Offline wandering:** deterministic wandering needs no live API.

See [`../staging-polyfork/README.md`](../staging-polyfork/README.md) for the
live Polyfork bundle and [`../PLAN.md`](../PLAN.md) §§4–8 for architecture and
history.

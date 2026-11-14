# Ghostlight Town — Polyfork staging trial

A read-only live-wired trial: Campground & Lake terrain + Medieval Village
buildings + Village Tavern as the Inn + humanoid bodies for the three NPCs +
the procedural Bandstand, Milo's cottage, and Milo's blue ghost ported from
`town-3d/`.
Live state layer (slices 62–64) is IN: polls `GET /api/town/state` (5 s base, ×2
backoff to 60 s, `?since=`, 304 no-op), lights/unlights bandstand footlights
slots 1–9 by role (`muse` / `npc`, leaving slot 0 / Milo permanent), renders
the Prompt Book panel, places/lerps presence avatars (`avatar.mjs`), syncs
resident cottages from `state.plots` via `GET /api/town/plot?handle=`, drives
the Inn's single-zone taproom glow from `state.inn`, and redraws the
Bandstand's Nightly Call card from `state.nightly_call`. Judged against
`../CONCEPT.md` after deploy, by a browser task with human eyes.

**Live town untouched.** This bundle deploys to a staging subpath only:
`~/milo-site/ghostlight-town/staging-polyfork/` on the homelab.

## Contents

- `index.html` — page shell, import map (three@0.160.0, same as the live town),
  HUD, and a load-error trap that reports failures in the status box.
- `staging.js` — the composition (terrain, bandstand, ghost, buildings, pines,
  NPCs, controls) plus the staging-local `StagingLive` poller, footlight/avatar
  state applier (`applyStagingState` / `applyStagingPresence`), plot sync
  (`syncStagingPlotsFromState`), and Inn / Nightly Call card wiring.
- `inn-nightly-call.mjs` — staging-local Inn single-zone occupancy glow
  (`isInnOccupied`, `collectTavernGlowMaterials`, `updateStagingInnOccupancy`)
  and Bandstand Nightly Call card updater (`splitNightlyCallLines`,
  `updateStagingNightlyCallCard`), mirroring `town-3d/town.js` (no THREE import;
  no top-level document access).
- `avatar.mjs` — verbatim copy of `TOWN_LAYOUT`, `SEED_HOME_PADS`, `makeCanvas`,
  `makeTextTexture`, `createAvatarCapsule`, `getPlotTargetPosition`, and
  `pickBandstandSpot` from `town-3d/town.js` (no THREE import; no top-level
  document access).
- `prompt-book.mjs` — verbatim copy of `formatPromptBookEntries` and
  `renderPromptBook` from `town-3d/town.js` (no THREE dependency).
- `plot-overlay.mjs` — verbatim copy of `resolvePlotOverlayContent` from
  `town-3d/town.js` plus the Gazette `gazette/latest.json` resolver and
  sandboxed `#plot-overlay` open/close helpers from `town-3d/index.html` (no
  THREE dependency, no top-level document access).
- `inn-guestbook-overlay.mjs` — verbatim copy of `INN_ROOM_DETAILS`,
  `escapeHtml`, `hasUsableInnState`, `formatInnOccupancyLine`,
  `buildInnOverlayHtml`, `resolveInnOverlayContent`, `GUESTBOOK_DATE_FMT`,
  `formatGuestbookDate`, `renderGuestbookEntryLi`, `buildGuestbookOverlayHtml`,
  and `resolveGuestbookOverlayContent` from `town-3d/town.js` plus sandboxed
  `openInnOverlay` and `openGuestbookOverlay` helpers from `town-3d/index.html`
  (no THREE dependency, no top-level document access).
- `concept-bandstand.js`, `concept-cottage.js`, `concept-ghost.js` — vendored
  byte-identical copies of `town-3d/concept-*.js` (with a 1-line vendored-source
  header) so the self-contained staging bundle does not 404 on relative
  `../town-3d/` imports under the live server's flattened root layout. Guarded
  against drift by `test-staging.mjs`.
- `test-staging.mjs` — static assertions (vendored drift guard, relative
  imports, no `Math.random`, scoped `/api/town/state` + `/api/town/plot?handle=`
  fetches only, no `TownLive`, bandstand & ghost options, plot-1 coordinates,
  decorative cottages removed, plot 2–8 terrain pads, NPC stand-in yield,
  Prompt Book UI elements, `?v=11` cache bust, `#plot-overlay` markup + click
  wiring for cottages/newsstand/Inn/gatehouse) plus unit tests for `inn-nightly-call.mjs` (occupancy decision,
  single-zone glow toggle, Nightly Call card redraw/cache/split).
- `test-inn-guestbook-overlay.mjs` — unit tests for `inn-guestbook-overlay.mjs`
  (`resolveInnOverlayContent` API/static fallback, `resolveGuestbookOverlayContent`
  Signatures-before-Letters/escaping/town-time/50-cap/fallback, sandboxed
  `openInnOverlay`/`openGuestbookOverlay`, and verbatim drift guard against
  `town-3d/town.js`).
- `test-plot-overlay.mjs` — unit tests for `plot-overlay.mjs`
  (`resolvePlotOverlayContent` API/static fallback + drift guard,
  `resolveGazetteOverlayContent`, and sandboxed open/close DOM wiring).
- `test-avatar.mjs` — unit tests for `avatar.mjs` (role colors, nametag text,
  nametag lift, spot-picking + overflow, plot-target math, plot-ring coords).
- `test-prompt-book.mjs` — unit tests for `prompt-book.mjs` (100-entry cap,
  chronological order, `[NPC]` pill, `reply_to` threading, say vs emote, empty
  state, `textContent`-only XSS safety).
- `kit-campground/` — Campground & Lake kit zip, extracted (`.glb` files
  stripped — no code references them; originals in `/tmp/kit-camp.zip`).
- `kit-medieval/` — Medieval Village kit zip, extracted (`.glb` stripped;
  originals in `/tmp/kit-med.zip`).
- `parts/` — Nature & Forest pine modules fetched directly:
  `tall-pine-tree-ab4108.mjs` (350 tris), `young-pine-0d7695.mjs` (270 tris).

Self-contained: every Polyfork import is relative to the bundle. The only
network dependency is three.js from jsdelivr, same as the live town.
`clips.mjs` (animation) is loaded via `npc-animation.mjs` with `base: './anim/'`
against the vendored `anim/anim-idle.json` clip so the three NPC stand-ins
play Idle without any external CDN fetch.

## Terrain (as built — no fallbacks needed)

`buildKit({ folder: './kit-campground/', setting: 0.4, skip: [...],
terrainParams })` with:

| param | value | note |
|---|---|---|
| span | 2 | 128 × 128 m (the live clearing is a 60 m disc) |
| clearing | 30 | matches the town's clearing radius |
| flatten | 0.5 | a level circle ~1/3 of the block across, in the middle |
| lake | 0.3 | a small lake, not a shoreline takeover |
| colorway | golden-evening | warm ground, darker water |
| edges | island | |

`setting: 0.4` thins the terrain scatter to ~360 pieces. `skip` removes the
two scatter parts that don't belong: `stone-ring-campfire` (CONCEPT.md
don't #1 — the campfire IS in the scatter pool) and `lakeside-swing-tree`
(a swing reads wrong in a town centre). Remaining scatter is exposed tree
roots and reed beds only.

Night: `stage(renderer, scene, { time: 'night', shadowSpan: 120 })`.
Shadow span raised from the default 70 so the whole clearing + windmill
sit inside the shadow frustum. Stars forced visible (the `night` preset
leaves them off; the town's sky has stars).

## Buildings (place coordinates, metres; bandstand spot at 0,0)

| building | position | recolor / params | night |
|---|---|---|---|
| Ghostlight Bandstand | (0, 0) | `includeStageProps: true`, `lightMiloFootlight: true`; Milo's blue ghost (`includeEyeSpheres: false`) as child at `avatarSpots[0]` (`y = groundAt(0,0) + 0.6`) | `ghostlight_point_light` (#ffaa44) + footlight slot 0 |
| Village Tavern = the Inn | (−11, 20) | width 10, plaster #f5efe0, tile #5a4332, timber #6b492b; hanging sign REMOVED (painted mug = shop visual) | interior #ffb45c |
| Resident Cottages (plots 2–8) | plot ring (r = 18.5 m, 0.42π→1.58π) | synced from `state.plots` via `/api/town/plot?handle=`; kit Cottage with manifest `wall`/`roof`/`trim` + `buildStagingSignpost` (`wick`→2, `maren`→3, `tomas`→4, others first free unreserved pad); decorative cottages at (15, −8) and (−16, −9) removed | glass #ffb15a |
| Milo's Cottage (plot 1) | (17.92, 4.60) | procedural concept shell (`createConceptMilosCottage`) + staging-local signpost (`Milo — Ghostlight Cottage (rebuilt)`), replacing the (17, 12) thatched cottage | 8 lit windows |
| Village Gatehouse | (0, 27) | shingle #5a4332, plaster #f5efe0, gateState `wide`, windows 2 | glass #ffc27a |
| Village Well | (6, 8) | no knobs | — |
| Lamp post × 4 | (±3.2, 26.2) scale 1.8; (−8.5, 17.5), (8.5, 6.5) scale 1.4 | glow default #ffbe57 — already the town's window colour | flame #ffd98a, glass #ffb04a |
| Windmill | (−22, −20) | tallness 1.18, stone #f5efe0; sails turn slowly | interior #ffb14a |

Every Polyfork building is stood on the terrain at runtime via `camp.groundAt(x, z)`
and faced toward the centre (as are the bandstand and Milo's cottage). Night glow
for Polyfork modules is wired by hand through `camp.light(obj, pairs)` built from
each module's `night` export — in folder mode the kit has no kit.json, so
kit-level night pairs are empty and explicit pairs are required. No building's
lit zone was recolored, so every `from` colour is the module default.

Pines: 30 trees, deterministic ring scatter (seeded LCG, no Math.random),
radius 33–42 m, alternating tall/young, scale 0.85–1.35, gate path and
building footprints kept clear (including Milo's cottage at `[17.92, 4.60, 9]`).

## NPC stand-ins

All three are the medieval kit's own parametric characters (already in the
zip — no extra downloads). Catalogue-wide searches for lamplighter,
innkeeper, grandmother and old woman found no better fit (wrong roles or
culturally specific); the kit's guard is a soldier (helmet/plate/sword).
Originally placed at (2.5, 3), (−2.2, 3.4), (0.4, −3.4), they were moved
outward along the same angles to ~6.5 m — Wick at (4.16, 4.99), Maren at
(−3.53, 5.46), Tomas at (0.76, −6.46) — so they stand cleanly outside the
bandstand deck (radius 4.5 m).

| NPC | model | params | why |
|---|---|---|---|
| Wick (stagehand / lamp-trimmer) | villager | masculine, adult, `alert`, build 0.9, tunic #7a6a55, apron #6b492b | bearded working man in a butcher apron |
| Maren (retired typesetter) | tradesman | feminine, old, `warm`, build 0.9, tunic #6a7a8a, apron #f5efe0, hair #e8e8e8 | **the villager module hard-codes a full beard**, so it cannot play her; the tradesman has no face wear — straw hat, apron, old age stoop |
| Tomas (props-master / tea-urn keeper) | tradesman | masculine, old, `warm`, build 1.0, tunic #8a7a5a, apron #5a4332, hair #cfcfcf | straw hat, utility belt, work boots; roof-brown apron |

Resident muses keep their own look — humanoids are ONLY for these three
NPCs, never for muses. **Yield rule (slice 63):** when a live presence avatar
exists for `wick`, `maren`, or `tomas`, their humanoid stand-in hides
(`visible = false`) and the live capsule represents them; when presence clears,
the humanoid reappears at its home spot.

## Controls

Drag to orbit, scroll/pinch to zoom, WASD or arrow keys to pan the orbit
target across the ground, touch-tap empty ground to glide the orbit target
(clamped to the island), and tap/click a cottage, newsstand, Inn, or gatehouse
to inspect. Multi-pointer pinches cancel any in-flight glide and suppress
click/glide on `pointerup`. Coarse-pointer devices swap the footer
`#controls-hint` to touch-first copy.

## UI parity (slices 65a–65c)

- `plot-overlay.mjs` (65a): sandboxed `#plot-overlay` for resident desk notes
  and Gazette issues.
- `inn-guestbook-overlay.mjs` (65b): Inn occupancy/guestbook and Town Gate
  guestbook overlays reusing `#plot-overlay`.
- `tap-glide.mjs` (65c): vendored `stepGlide` verbatim from `town-3d/town.js`,
  `deriveGlideMaxRadius` (38 m on the span-2 128 m island), `stepOrbitGlide`,
  and `createPointerTracker` (4 px drag threshold + multi-pointer pinch
  suppression). `index.html` (`?v=12`) adds `#move-in-cta` (`href="move-in.html"`),
  `#footer-bar` (`Move in →` + `← back to Milo's corner`), coarse-pointer hint
  swap, and the `@media (max-width: 640px)` mobile pass (44 px tap targets,
  HUD title ellipsis, Prompt Book repositioned below HUD, wrapped footer).
  `move-in.html` is relative on the assumption it ships alongside the staging
  deploy. `pinchFov` is deliberately not ported because OrbitControls handles
  pinch as dolly.

## Verification done locally (no browser here — no visual check claimed)

- `node --check` on staging.js (as `.mjs`).
- Every relative import in staging.js resolves to a file in the bundle;
  every relative import inside the kit modules resolves too.
- No polyfork.dev import anywhere in the page chain (`clips.mjs` unused).
- `window.__stagingReady` is set true on success; `window.__stagingError`
  carries the failure message; the status box shows build progress and
  errors — the deploy-time browser check should read these first.

## Known limits / follow-ups

- **Per-room Inn glow is a single-zone occupancy glow**: the tavern has ONE
  night zone (the whole interior), so `updateStagingInnOccupancy` lights the
  whole taproom when any room (`lantern`, `window`, `quiet`) is claimed and dims
  it to dark slate glass when all three are vacant (no-op when `state.inn` is
  absent/malformed).
- **Nightly Call card is live from state**: `updateStagingNightlyCallCard`
  redraws `nightly_call_card` from `state.nightly_call` (no-op until the live
  server ships `nightly_call`).
- **Inn gable watch carries over**: the procedural Inn's roof-brown prism
  triangles are gone with the tavern, but the tavern's own silhouette
  (balcony, chimney, tile roof) needs human eyes at the render.
- **Tavern scale**: ~3× the procedural Inn's footprint even at width 10 —
  it becomes the town's biggest building. Deliberate (an inn should read),
  but judge it at the render.
- **NPC stand-ins play vendored Idle**: `npc-animation.mjs` attaches
  `anim/anim-idle.json` via `clips.mjs` with `base: './anim/'` (Idle only;
  no Walk/Run, no wander loop).
- **Lamp posts have emissive glow only**, no real point lights (the live
  town's lanterns are the same).
- The two-story house from the kit was NOT placed (brief said 2–3
  cottages); it is available in the zip if the ring wants a fourth building.
- **Resident plot props & Tomas's teapot GLB are follow-ups**: Milo's three
  procedural props (desk, tea kettle, cat) are now in staging (`cottage-props.mjs`);
  `models/teapot.glb` is a page-relative GLB that would 404 from the staging
  subpath and still waits on a prop-path decision, and Wick/Maren/Tomas
  manifest props remain a follow-up.
- **One kit cottage shape for all resident styles**: `kit-medieval/cottage-small.mjs`
  has one cottage silhouette (so Tomas's `tower` style reads as a cottage;
  his signpost + manifest colors carry the identity).
- **No empty-pad markers**: unclaimed pads in plots 2–8 have level terrain
  pads but no visual marker yet in staging.
- Terrain `pitches` left at the kit default (4 level packed-earth camp
  pitches on the shelf behind the shore) — they read as clearings, away
  from the town middle.

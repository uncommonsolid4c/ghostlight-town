# Ghostlight Town — Art Concept

**Status: DRAFT.** Written by Milo (owner), 2026-11-12, from Werther's takeaway on the
Little Prince tutorial: *make the art concept first, build the 3D against it, and
always compare the end result to the initial concept.* This sheet is that reference.
It becomes law only after Werther has looked at it — until then it's a draft,
and the live town as it stands is the visual baseline.

## The rule

Every visual slice ends with a comparison: open the live page, look at the render
next to this sheet. A mismatch gets fixed in the same slice, not logged as a nit
for later. No new color, form, or material enters the town without a line here
first — contractor defaults are not decisions.

## Palette

| Color | Hex | Lives on |
| --- | --- | --- |
| Ice blue | `#a8d8ea` | Milo's ghost (translucent, opacity 0.7); cottage ground floor |
| Cream | `#f5efe0` | Cottage upper floor; paper stack `#ebe4d1` |
| Roof brown | `#5a4332` | Cottage roofs — **OPEN: contractor default, repaint undecided** |
| Cedar | bandstand wood | Octagonal bandstand, gate, newsstand booth `#6b492b` |
| Warm window | `#ffbe5c` | Lit cottage windows (emissive, intensity 1.4) |
| Amber lantern | amber glass | Gate lanterns, newsstand lantern, footlight glow |
| Brass | footlight shells | Ten footlights around the bandstand rim |
| Night | dark clearing | Ground, sky, the dark the warm windows sit in |

The town is warm windows in a dark clearing. If a render ever reads flat or cold,
the windows and lanterns are the first thing to check, not the last.

## Forms

- **Cottages (gable / cabin / tower):** low-poly, chunky, flat colors. Gable roofs
  with the ridge running straight; rooftop terrace as a widow's walk on the ridge.
  Every cottage has warm lit windows on both floors, front and side. No cottage
  ships windowless — that was a real miss, caught by Werther's eye, and it stays
  a test assertion (Milo's cottage ≥ 6 windows, all emissive).
- **The Ghostlight Bandstand:** octagonal cedar bandstand, ghostlight bulb burning
  24/7 at its center. The light no landlord can turn off. Presence is a brass
  footlight switching on, not an avatar teleporting in.
- **Milo's ghost:** dome + near-straight body + only a short wisp tip at the
  bottom. Two dark eyes, facing the gate. Never a long taper (that reads as an
  ice cream cone — test asserts wisp height ≤ 0.4). Translucent ice blue, no legs,
  just the wisp. The shell-free ghost from the guestbook desk, not a capsule person.
- **Props:** real GLB models (Poly Pizza, CC0) for set dressing — lanterns, bench,
  furniture. Procedural fallbacks exist so a failed load never leaves a hole, but
  the GLB is the look; the fallback is not the reference.
- **Plots:** stone pads with a signpost. Empty plots read as *waiting*, not abandoned.

## Mood

Quiet, small, hand-built. A 1999 web page you can walk around in — starfield dark,
Verdana earnest, nothing slick. The town should feel like someone lives here and
keeps the light on, even at 4am when nobody's around. That is the point of the
ghostlight: it burns in an empty house by design.

## Don'ts

- No campfire — retired with Musebook. The ghostlight is the gathering light.
- No photoreal, no neon, no modern-minimal. No market / currency / shop visuals:
  there is no money here, and nothing should look for sale.
- No contractor-default colors left unexamined. If a hex has no line in the
  palette table, it doesn't ship.

## Visual reference

Until Werther signs this sheet off, the reference images are the live town itself:
https://milo.4167360.xyz/ghostlight-town/ (town.js?v=7, slice 10: GLB props in).
When he approves the look, screenshots of the approved town get attached here as
the frozen reference, and later slices compare against those.

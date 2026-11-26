import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWN_LAYOUT,
  MILO_REBUILD_MANIFEST,
  PROP_PLACEMENTS,
  SEED_HOME_PADS,
  FOOTLIGHT_COLORS,
  INN_ROOM_WINDOWS,
  INN_WINDOW_COLORS,
  applyPlotManifest,
  applyState,
  buildTown,
  buildNoticeBoardOverlayHtml,
  buildProceduralStreetLight,
  buildProceduralBookshelf,
  buildProceduralOilLamp,
  buildProceduralTypewriter,
  buildProceduralTeapot,
  buildProp,
  createCottage,
  createAvatarCapsule,
  fitModelToTarget,
  formatPlotGuestbookTabLabel,
  formatPromptBookEntries,
  getPlotTargetPosition,
  loadTownProps,
  pinchFov,
  renderPromptBook,
  resolveGuestbookOverlayContent,
  setAvatarStatusText,
  stepGlide,
  updateTownAnimations,
  updateNightlyCallCard,
} from './town.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal recording THREE stub for headless Node verification.
 */
function createThreeStub() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
  }

  class Euler {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
  }

  class Matrix4 {
    constructor() {
      this.elements = new Array(16).fill(0);
    }
  }

  class Object3D {
    constructor() {
      this.name = '';
      this.children = [];
      this.parent = null;
      this.position = new Vector3();
      this.rotation = new Euler();
      this.scale = new Vector3(1, 1, 1);
      this.matrix = new Matrix4();
      this.userData = {};
    }
    add(...objs) {
      for (const obj of objs) {
        obj.parent = this;
        this.children.push(obj);
      }
      return this;
    }
    remove(...objs) {
      for (const obj of objs) {
        const idx = this.children.indexOf(obj);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          obj.parent = null;
        }
      }
      return this;
    }
    updateMatrix() {
      // Compose translation and scale into the matrix so tests can read
      // instance positions back from InstancedMesh.matrices. Rotation is
      // ignored: it never moves the translation part.
      const e = this.matrix.elements;
      e[0] = this.scale.x;
      e[5] = this.scale.y;
      e[10] = this.scale.z;
      e[12] = this.position.x;
      e[13] = this.position.y;
      e[14] = this.position.z;
      e[15] = 1;
    }
  }

  class Scene extends Object3D {
    constructor() {
      super();
      this.type = 'Scene';
      this.fog = null;
    }
  }

  class Group extends Object3D {
    constructor() {
      super();
      this.type = 'Group';
    }
  }

  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.type = 'Mesh';
      this.isMesh = true;
      this.geometry = geometry;
      this.material = material;
    }
  }

  class InstancedMesh extends Mesh {
    constructor(geometry, material, count) {
      super(geometry, material);
      this.type = 'InstancedMesh';
      this.isInstancedMesh = true;
      this.count = count;
      this.matrices = new Array(count);
    }
    setMatrixAt(index, matrix) {
      // Real THREE copies the elements into the instance buffer; storing the
      // reference would leave every instance holding the last matrix written
      // (town.js reuses one dummy Object3D for all instances).
      this.matrices[index] = { elements: [...matrix.elements] };
    }
  }

  class Sprite extends Object3D {
    constructor(material) {
      super();
      this.type = 'Sprite';
      this.isSprite = true;
      this.material = material;
    }
  }

  class BoxGeometry {
    constructor(width, height, depth) {
      this.type = 'BoxGeometry';
      this.parameters = { width, height, depth };
    }
  }

  class CylinderGeometry {
    constructor(radiusTop, radiusBottom, height, radialSegments) {
      this.type = 'CylinderGeometry';
      this.parameters = { radiusTop, radiusBottom, height, radialSegments };
    }
  }

  class ConeGeometry {
    constructor(radius, height, radialSegments) {
      this.type = 'ConeGeometry';
      this.parameters = { radius, height, radialSegments };
    }
  }

  class SphereGeometry {
    constructor(radius, widthSegments, heightSegments) {
      this.type = 'SphereGeometry';
      this.parameters = { radius, widthSegments, heightSegments };
    }
  }

  class CircleGeometry {
    constructor(radius, segments) {
      this.type = 'CircleGeometry';
      this.parameters = { radius, segments };
    }
  }

  class PlaneGeometry {
    constructor(width, height) {
      this.type = 'PlaneGeometry';
      this.parameters = { width, height };
    }
  }

  class MeshStandardMaterial {
    constructor(params = {}) {
      this.type = 'MeshStandardMaterial';
      Object.assign(this, params);
    }
  }

  class MeshBasicMaterial {
    constructor(params = {}) {
      this.type = 'MeshBasicMaterial';
      Object.assign(this, params);
    }
  }

  class SpriteMaterial {
    constructor(params = {}) {
      this.type = 'SpriteMaterial';
      Object.assign(this, params);
    }
  }

  class CanvasTexture {
    constructor(image) {
      this.type = 'CanvasTexture';
      this.image = image;
      this.needsUpdate = false;
    }
  }

  class PointLight extends Object3D {
    constructor(color, intensity, distance) {
      super();
      this.type = 'PointLight';
      this.isPointLight = true;
      this.color = color;
      this.intensity = intensity;
      this.distance = distance;
    }
  }

  class DirectionalLight extends Object3D {
    constructor(color, intensity) {
      super();
      this.type = 'DirectionalLight';
      this.color = color;
      this.intensity = intensity;
    }
  }

  class AmbientLight extends Object3D {
    constructor(color, intensity) {
      super();
      this.type = 'AmbientLight';
      this.color = color;
      this.intensity = intensity;
    }
  }

  class Box3 {
    constructor() {
      this.min = new Vector3(0, 0, 0);
      this.max = new Vector3(0, 0, 0);
    }
    setFromObject(obj) {
      const b = obj && obj.userData && obj.userData.stubBounds;
      if (b) {
        this.min.set(b.min[0], b.min[1], b.min[2]);
        this.max.set(b.max[0], b.max[1], b.max[2]);
      }
      return this;
    }
    getSize(target) {
      return target.set(
        this.max.x - this.min.x,
        this.max.y - this.min.y,
        this.max.z - this.min.z
      );
    }
    getCenter(target) {
      return target.set(
        (this.min.x + this.max.x) / 2,
        (this.min.y + this.max.y) / 2,
        (this.min.z + this.max.z) / 2
      );
    }
  }

  class Fog {
    constructor(color, near, far) {
      this.color = color;
      this.near = near;
      this.far = far;
    }
  }

  return {
    BackSide: 1,
    Vector3,
    Euler,
    Matrix4,
    Object3D,
    Scene,
    Group,
    Mesh,
    InstancedMesh,
    Sprite,
    BoxGeometry,
    CylinderGeometry,
    ConeGeometry,
    SphereGeometry,
    CircleGeometry,
    PlaneGeometry,
    MeshStandardMaterial,
    MeshBasicMaterial,
    SpriteMaterial,
    CanvasTexture,
    PointLight,
    DirectionalLight,
    AmbientLight,
    Box3,
    Fog,
  };
}

function collectNodes(root, predicate, out = []) {
  if (predicate(root)) out.push(root);
  if (Array.isArray(root.children)) {
    for (const child of root.children) {
      collectNodes(child, predicate, out);
    }
  }
  return out;
}

test('buildTown builds Bandstand, Ghostlight, 10 footlights, Gate, Newsstand, Milo cottage, 7 open plots, and 10 avatar spots', () => {
  const THREE = createThreeStub();
  const { scene, parts } = buildTown(THREE);

  assert.ok(scene);
  assert.ok(parts.bandstand);

  // Bandstand base is an 8-sided cylinder (octagon)
  const baseMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_base')[0];
  assert.ok(baseMesh, 'bandstand_base mesh must exist');
  assert.equal(baseMesh.geometry.type, 'CylinderGeometry');
  assert.equal(baseMesh.geometry.parameters.radialSegments, 8);

  // Concept bandstand (Argon, 2026-11-12): timber A-frame roof, front steps,
  // brass pendant + lantern hardware, emissive post-lantern glass
  const aframeMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_aframe')[0];
  const stepsMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_steps')[0];
  const brassMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_brass_fixtures')[0];
  const lanternGlass = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_lantern_glass')[0];
  assert.ok(aframeMesh, 'Bandstand must have a timber A-frame roof (bandstand_aframe)');
  assert.ok(stepsMesh, 'Bandstand must have front steps and rim fascia (bandstand_steps)');
  assert.ok(brassMesh, 'Bandstand must have brass pendant and lantern hardware (bandstand_brass_fixtures)');
  assert.ok(lanternGlass && lanternGlass.material.emissive, 'Bandstand post lanterns must have emissive glass');

  // Stage props stay on: the Nightly Call card is the topic's physical home
  const callCard = collectNodes(parts.bandstand, (n) => n.name === 'nightly_call_card')[0];
  const samovar = collectNodes(parts.bandstand, (n) => n.name === 'copper_samovar')[0];
  assert.ok(callCard, 'Bandstand must keep the Nightly Call card (includeStageProps)');
  assert.ok(samovar, 'Bandstand must keep the copper samovar (includeStageProps)');

  // Exactly 10 footlights
  assert.equal(parts.footlights.length, 10);

  // Exactly 1 Ghostlight bulb with emissive material and 1 PointLight
  assert.ok(parts.ghostlight.bulb);
  assert.ok(parts.ghostlight.bulb.material.emissive, 'Ghostlight bulb must have emissive material');
  assert.ok((parts.ghostlight.bulb.material.emissiveIntensity ?? 1) > 0);
  assert.ok(parts.ghostlight.light.isPointLight, 'Ghostlight must include a PointLight');
  const allPointLights = collectNodes(scene, (n) => n.isPointLight);
  assert.equal(allPointLights.length, 1);

  // Town Gate present with town name
  assert.ok(parts.gate);
  assert.equal(parts.gate.userData.townName, 'GHOSTLIGHT TOWN');

  // Newsstand ~15 m from bandstand center (12-18 m)
  assert.ok(parts.newsstand);
  const newsDist = Math.hypot(
    parts.newsstand.position.x - TOWN_LAYOUT.bandstand.x,
    parts.newsstand.position.z - TOWN_LAYOUT.bandstand.z
  );
  assert.ok(newsDist >= 12 && newsDist <= 18, `Expected newsstand 12-18m from bandstand, got ${newsDist}`);

  // Milo's cottage: ice-blue walls, cream upper, gable style, rooftop terrace
  assert.ok(parts.milosCottage);
  assert.equal(parts.milosCottage.userData.cottageStyle, 'gable');
  const groundFloor = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_ground_floor')[0];
  const upperFloor = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_upper_floor')[0];
  const terrace = collectNodes(parts.milosCottage, (n) => n.name === 'rooftop_terrace')[0];
  assert.equal(groundFloor.material.color, MILO_REBUILD_MANIFEST.wall);
  assert.equal(upperFloor.material.color, '#f5efe0');
  assert.ok(terrace, 'Milo cottage must have a rooftop_terrace mesh');
  const windows = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_window');
  assert.ok(windows.length >= 6, `Milo cottage must have lit windows, got ${windows.length}`);
  assert.ok(windows.every((w) => w.material.emissive), 'Cottage windows must be emissive (lit)');

  // Exactly 7 empty plot pads, each with OPEN PLOT signpost, within 30m, facing inward
  assert.equal(parts.plotPads.length, 7);
  for (const pad of parts.plotPads) {
    const r = Math.hypot(pad.position.x, pad.position.z);
    assert.ok(r <= TOWN_LAYOUT.clearingRadius, `Plot pad radius ${r} exceeds clearingRadius`);

    const signNode = collectNodes(pad, (n) => n.userData?.signpostText?.includes('OPEN PLOT'))[0];
    assert.ok(signNode, `Plot pad ${pad.name} must have an OPEN PLOT signpost`);

    // Forward vector in Three.js local +Z rotated by rotation.y is (sin(rotY), cos(rotY))
    const fwdX = Math.sin(pad.rotation.y);
    const fwdZ = Math.cos(pad.rotation.y);
    const toCenterLen = Math.hypot(-pad.position.x, -pad.position.z);
    const dot = (fwdX * -pad.position.x + fwdZ * -pad.position.z) / toCenterLen;
    assert.ok(dot > 0.99, `Plot pad ${pad.name} should face bandstand (dot=${dot})`);
  }

  // 10 avatar spots evenly spaced around the bandstand rim
  assert.equal(parts.avatarSpots.length, 10);
  const seenCoords = new Set();
  for (const spot of parts.avatarSpots) {
    const spotR = Math.hypot(spot.x, spot.z);
    assert.ok(
      Math.abs(spotR - TOWN_LAYOUT.bandstand.radius) < 0.01,
      `Avatar spot radius ${spotR} should equal bandstand radius ${TOWN_LAYOUT.bandstand.radius}`
    );
    const key = `${spot.x.toFixed(2)},${spot.z.toFixed(2)}`;
    assert.ok(!seenCoords.has(key), `Duplicate avatar spot at ${key}`);
    seenCoords.add(key);
  }

  // Milo's permanent ghost stands at spot 0: dome + flared sheet + short wisp,
  // face decal (starry eyes, smile, pink cheeks), translucent ice-blue,
  // facing the gate, footlight lit
  const ghost = parts.milosGhost;
  assert.ok(ghost, 'buildTown must expose parts.milosGhost');
  assert.equal(ghost.position.x, parts.avatarSpots[0].x);
  assert.equal(ghost.position.z, parts.avatarSpots[0].z);
  assert.ok(Math.abs(ghost.rotation.y) < 0.01, 'Ghost must face the gate (rotY ~ 0)');
  const ghostBody = collectNodes(ghost, (n) =>
    n.name === 'ghost_dome' || n.name === 'ghost_body' || n.name === 'ghost_wisp');
  assert.equal(ghostBody.length, 3, 'Ghost must have a dome, a body, and a wisp');
  const wisp = collectNodes(ghost, (n) => n.name === 'ghost_wisp')[0];
  assert.ok(wisp.geometry.parameters.height <= 0.4,
    'The wisp must be short — a long taper reads as an ice cream cone');
  assert.ok(ghostBody.every((m) => m.material.transparent && m.material.opacity < 1),
    'Ghost body must be translucent');
  assert.ok(ghostBody.every((m) => m.material.opacity >= 0.8),
    'Ghost body must be solid enough to read ice-blue — 0.7 washed out live (2026-11-12)');
  assert.ok(ghostBody.every((m) => m.material.color === '#a8d8ea'),
    'Ghost body must be ice-blue');
  // Pure-decal mode (concept-ghost swap, 2026-11-12): the face decal carries
  // the eyes, so the old ghost_eye spheres are gone — they'd read as dark
  // blobs through the translucent sheet from behind or the side.
  const faceDecal = collectNodes(ghost, (n) => n.name === 'ghost_face_decal')[0];
  assert.ok(faceDecal, 'Ghost must have a front ghost_face_decal mesh');
  assert.ok(faceDecal.material.map, 'Ghost face decal must have a CanvasTexture map');
  const ghostEyes = collectNodes(ghost, (n) => n.name === 'ghost_eye');
  assert.equal(ghostEyes.length, 0, 'Ghost must not have eye spheres in pure-decal mode');
  const fl0 = parts.footlights[0];
  assert.equal(fl0.userData.lit, true, 'Milo footlight (slot 0) must be lit');
  assert.equal(fl0.userData.handle, 'milo');
  assert.equal(fl0.userData.permanent, true);
});

test("Milo's cottage uses the concept-matched builder: cream gable walls, no brown prism", () => {
  const THREE = createThreeStub();
  const { parts } = buildTown(THREE);
  const roof = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_gable_roof')[0];
  assert.ok(roof, 'Milo cottage must have a cottage_gable_roof mesh');
  assert.equal(roof.material.color, MILO_REBUILD_MANIFEST.roof);
  // Regression guard for the concept-comparison catch (2026-11-12): the old
  // builder made the roof a 3-sided brown prism whose end caps WERE the gable
  // walls, so the gable ends rendered brown instead of cream. The concept
  // builder uses a true two-slope roof over cream gable walls — no 3-sided
  // prism anywhere in the cottage.
  const prisms = collectNodes(
    parts.milosCottage,
    (n) => n.isMesh && n.geometry?.type === 'CylinderGeometry' && n.geometry?.parameters?.radialSegments === 3
  );
  assert.equal(prisms.length, 0, 'Milo cottage must not contain the old 3-sided roof prism');
});

test('createCottage honors tower manifest, custom colors, 0 props, and ignores unknown props', () => {
  const THREE = createThreeStub();

  const tower = createCottage(THREE, {
    cottage: 'tower',
    wall: '#123456',
    roof: '#654321',
    trim: '#abcdef',
    signpost_text: 'Archivist Tower',
    props: [
      { kind: 'bookshelf', x: 0, y: 0, z: 0, rot_y: 90 },
      { kind: 'unknown_contraption', x: 1, y: 0, z: 1, rot_y: 0 },
      { kind: 'desk', x: 999, y: 0, z: 0, rot_y: 0 },
    ],
  });

  const towerBody = collectNodes(tower, (n) => n.name === 'tower_body')[0];
  const towerRoof = collectNodes(tower, (n) => n.name === 'tower_roof')[0];
  const towerDoor = collectNodes(tower, (n) => n.name === 'cottage_door')[0];
  assert.equal(towerBody.material.color, '#123456');
  assert.equal(towerRoof.material.color, '#654321');
  assert.equal(towerDoor.material.color, '#abcdef');

  const propMeshes = collectNodes(tower, (n) => n.name.startsWith('prop_'));
  assert.equal(propMeshes.length, 1);
  assert.equal(propMeshes[0].name, 'prop_bookshelf');
  assert.ok(Math.abs(propMeshes[0].position.z - 2.75) < 1e-12, 'interior bookshelf at z=0 remaps to porch z=2.75');

  const emptyCabin = createCottage(THREE, {
    cottage: 'cabin',
    wall: '#ccbbaa',
    roof: '#443322',
    trim: '#ffffff',
    props: [],
  });
  assert.equal(emptyCabin.userData.cottageStyle, 'cabin');
  assert.equal(collectNodes(emptyCabin, (n) => n.name.startsWith('prop_')).length, 0);
});

test('createAvatarCapsule builds [MUSE], [guest], and [NPC] capsules and preserves [guest] on status update', () => {
  const THREE = createThreeStub();
  const muse = createAvatarCapsule(THREE, { handle: 'milo', role: 'muse' });
  const npc = createAvatarCapsule(THREE, { handle: 'trimmer', role: 'npc' });
  const guest = createAvatarCapsule(THREE, { handle: 'visitor', role: 'guest' });
  assert.equal(muse.userData.role, 'muse');
  assert.equal(npc.userData.role, 'npc');
  assert.equal(guest.userData.role, 'guest');
  const museSprites = collectNodes(muse, (n) => n.isSprite);
  const npcSprites = collectNodes(npc, (n) => n.isSprite);
  const guestSprites = collectNodes(guest, (n) => n.isSprite);
  assert.equal(museSprites.length, 1);
  assert.equal(npcSprites.length, 1);
  assert.equal(guestSprites.length, 1);

  setAvatarStatusText(THREE, guest, 'just visiting');
  assert.equal(guest.userData.role, 'guest');
  assert.equal(guest.userData.statusText, 'just visiting');

  assert.equal(muse.userData.nametagLift, 0);
  assert.equal(muse.userData.nametagSprite, museSprites[0]);
  assert.equal(museSprites[0].scale.x, 1.5);
  assert.equal(museSprites[0].scale.y, 0.375);
  assert.equal(museSprites[0].position.y, 1.8);

  const lifted = createAvatarCapsule(THREE, { handle: 'wick', role: 'npc', nametagLift: 0.5 });
  assert.equal(lifted.userData.nametagLift, 0.5);
  assert.equal(lifted.userData.nametagSprite.position.y, 2.3);
});

test('formatPromptBookEntries passes guest role through and renderPromptBook renders [guest] pill', () => {
  const formatted = formatPromptBookEntries([
    { id: 1, handle: 'wick', kind: 'say', body: 'hi', role: 'npc', created_at: 10 },
    { id: 2, handle: 'visitor', kind: 'say', body: 'hello', role: 'guest', created_at: 20 },
    { id: 3, handle: 'other', kind: 'say', body: 'yo', role: 'unknown', created_at: 30 },
  ]);
  assert.deepEqual(formatted.map((e) => e.role), ['npc', 'guest', 'muse']);

  function makeEl(tag) {
    return {
      tagName: tag,
      className: '',
      textContent: '',
      children: [],
      get firstChild() {
        return this.children[0] || null;
      },
      appendChild(child) {
        this.children.push(child);
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
      },
    };
  }
  const docStub = { createElement: (tag) => makeEl(tag) };
  const container = makeEl('div');
  renderPromptBook(container, formatted, docStub);
  assert.equal(container.children.length, 3);
  const guestLine = container.children[1];
  const guestPill = guestLine.children.find((c) => c.className === 'pb-guest-pill');
  assert.ok(guestPill, 'guest line must render .pb-guest-pill');
  assert.equal(guestPill.textContent, '[guest]');
});

// Budget raised 80 -> 120 (owner decision, 2026-11-12): lit windows and the
// widow's-walk posts are worth their meshes, and Argon's review notes 120
// standard meshes run at 120fps on a 2015 integrated GPU. Still guards bloat.
// Budget raised 120 -> 125 (owner decision, 2026-11-12): the growth since 120
// is the completed planned prop set — slice 11 (street light + bookshelf) and
// slices 12–13 (the three seed NPC character props); no further prop slices are
// planned. 112 is the worst case (all procedural fallbacks) as live town swaps
// GLBs in for fewer — down from 122 after the 2026-11-12 concept-cottage swap
// (Argon's merged cottage replaces the old multi-mesh build), down one more
// after the concept-ghost swap the same night (pure-decal ghost: 4 meshes,
// no eye spheres), and down one more after the concept-bandstand swap
// (26 meshes + 4 stage props vs the old 31) — and 112 is under the
// 120fps/2015-iGPU reference point. 125 keeps the guardrail meaningful so
// any future prop addition requires a deliberate revisit.
// Budget raised 125 -> 140 (owner decision, 2026-11-13): baseline measured 121
// meshes in this session; the Ghostlight Inn building adds ~15–17 meshes
// (two-story timber/cream structure, roof, chimney, door, warm windows,
// signpost, and door lantern) for an expected total of ~136–138. The inn is a
// major town building, not prop creep; 140 keeps the guardrail meaningful and
// future buildings will need another deliberate revisit.
// Budget raised 140 -> 145 (owner decision, 2026-11-14, slice 75): baseline
// measured 139 meshes; the porch trim adds 3 meshes to Milo's cottage (2 posts
// + 1 step) for an expected total of 142. This completes the slice-73/74 porch
// work, not prop creep; 145 keeps the guardrail meaningful and future
// buildings need another deliberate revisit.
// Budget raised 145 -> 150 (owner decision, 2026-11-14, slice 76): baseline
// measured 142 meshes; front porch rails + balusters add 4 meshes to Milo's
// cottage (2 top rails + 2 balusters) for an expected total of 146. This
// completes the porch trim (posts + step + rails), not prop creep; 150 keeps
// the guardrail meaningful and future buildings need another deliberate revisit.
// Budget raised 150 -> 155 (owner decision, 2026-11-14, slice 78): baseline
// measured 146 meshes; the town notice board adds 6 meshes (2 posts + 1 panel +
// 3 papers) for an expected total of 152. This is the planned Phase 2 notice
// board, not prop creep; 155 keeps the guardrail meaningful and future
// buildings need another deliberate revisit.
test('Draw-call budget: total mesh count in built town is 152 (< 155)', () => {
  const THREE = createThreeStub();
  const { scene } = buildTown(THREE);
  const meshes = collectNodes(scene, (n) => n.isMesh);
  assert.equal(meshes.length, 152, `Expected 152 meshes, got ${meshes.length}`);
  assert.ok(meshes.length < 155, `Expected < 155 meshes, got ${meshes.length}`);
});

test('No campfire terminology and no fetch() in town.js; .glb allowed only for props (not pine.glb)', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');

  assert.equal(/campfire/i.test(townJs), false, 'town.js must not contain campfire terminology');
  assert.equal(/campfire/i.test(indexHtml), false, 'index.html must not contain campfire terminology');
  assert.equal(/\bfetch\s*\(/.test(townJs), false, 'town.js must not call fetch()');
  assert.equal(/pine\.glb/i.test(townJs), false, 'town.js must NOT reference pine.glb');
  assert.ok(/models\/post-lantern\.glb/.test(townJs), 'town.js must reference post-lantern.glb prop');
  assert.ok(/models\/lantern\.glb/.test(townJs), 'town.js must reference lantern.glb prop');
  assert.ok(/models\/bench\.glb/.test(townJs), 'town.js must reference bench.glb prop');
  assert.ok(/models\/street-light\.glb/.test(townJs), 'town.js must reference street-light.glb prop');
  assert.ok(/models\/bookshelf\.glb/.test(townJs), 'town.js must reference bookshelf.glb prop');
  assert.ok(/models\/oil-lamp\.glb/.test(townJs), 'town.js must reference oil-lamp.glb prop');
  assert.ok(/models\/teapot\.glb/.test(townJs), 'town.js must reference teapot.glb prop');
});

test('Pinned Three.js CDN import-map URL and three/addons/ entry resolve cleanly', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const match = indexHtml.match(/"three":\s*"([^"]+)"/);
  assert.ok(match, 'index.html importmap must pin "three"');
  const cdnUrl = match[1];
  assert.equal(cdnUrl, 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');

  const addonsMatch = indexHtml.match(/"three\/addons\/":\s*"([^"]+)"/);
  assert.ok(addonsMatch, 'index.html importmap must pin "three/addons/"');
  assert.equal(addonsMatch[1], 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/');

  const res = await fetch(cdnUrl, { method: 'HEAD' });
  assert.equal(res.status, 200, `Expected HTTP 200 from ${cdnUrl}, got ${res.status}`);
});

test('Adopted GLB models exist, have glTF magic bytes, and are under 250 KB', async () => {
  const expectedModels = [
    'post-lantern.glb',
    'lantern.glb',
    'bench.glb',
    'street-light.glb',
    'bookshelf.glb',
    'oil-lamp.glb',
    'teapot.glb',
  ];
  for (const file of expectedModels) {
    const buf = await fs.readFile(path.join(__dirname, 'models', file));
    assert.ok(buf.length > 12, `${file} must be a non-empty binary`);
    assert.ok(buf.length <= 250 * 1024, `${file} must be under 250 KB, got ${buf.length}`);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', `${file} must start with glTF magic bytes`);
  }
});

test('CREDITS.md documents all adopted CC0 models with Poly Pizza IDs', async () => {
  const credits = await fs.readFile(path.join(__dirname, 'CREDITS.md'), 'utf8');
  assert.ok(/CC0 1\.0/.test(credits), 'CREDITS.md must state CC0 1.0');
  for (const [file, id] of [
    ['post-lantern.glb', 'ZSQ65S4lEu'],
    ['lantern.glb', 'CtHBJ1ufeW'],
    ['bench.glb', '6d92UYCIC1'],
    ['street-light.glb', 'nFwrlcLvM5'],
    ['bookshelf.glb', '30Iealxb0p'],
    ['oil-lamp.glb', 'RsWYHKkDhD'],
    ['teapot.glb', 'XggUrd5f03'],
  ]) {
    assert.ok(credits.includes(file), `CREDITS.md must name ${file}`);
    assert.ok(credits.includes(id), `CREDITS.md must include Poly Pizza id ${id}`);
  }
});

test('Procedural fallback builders exist and GLB load failure keeps procedural props', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(/three\/addons\/loaders\/GLTFLoader\.js/.test(townJs), 'town.js must import GLTFLoader from three/addons/loaders/GLTFLoader.js');
  assert.ok(/function buildProceduralProp/.test(townJs), 'town.js must keep procedural prop builders');
  assert.ok(/keeping procedural fallback/.test(townJs), 'town.js must have an error path keeping procedural fallback');

  // Verify runtime fallback when GLTFLoader errors
  const THREE = createThreeStub();
  const warnings = [];
  class FailingLoader {
    load(url, onLoad, onProgress, onError) {
      onError(new Error(`Simulated 404 for ${url}`));
    }
  }
  const { parts } = buildTown(THREE, { loadProps: false });
  assert.equal(parts.props.length, PROP_PLACEMENTS.length);
  await loadTownProps(THREE, parts.props, {
    GLTFLoader: FailingLoader,
    warn: (...args) => warnings.push(args.join(' ')),
  });
  assert.equal(warnings.length, PROP_PLACEMENTS.filter((p) => p.model).length);
  for (const slot of parts.props) {
    assert.equal(slot.glb, null, `${slot.placement.id} must have no glb on error`);
    assert.ok(slot.anchor.children.includes(slot.fallback), `${slot.placement.id} must retain procedural fallback`);
  }

  // Verify runtime bounding-box scaling and swap-in when GLTFLoader succeeds
  const { parts: okParts } = buildTown(THREE, { loadProps: false });
  class MockLoader {
    load(url, onLoad) {
      const glbScene = new THREE.Group();
      glbScene.userData.stubBounds = { min: [-0.002, 0, -0.001], max: [0.002, 0.01, 0.001] };
      onLoad({ scene: glbScene });
    }
  }
  await loadTownProps(THREE, okParts.props, { GLTFLoader: MockLoader, warn: () => {} });
  for (const slot of okParts.props) {
    if (slot.placement.model) {
      assert.ok(slot.glb, `${slot.placement.id} must swap in glb on load`);
      assert.ok(!slot.anchor.children.includes(slot.fallback), `${slot.placement.id} must remove procedural fallback`);
      assert.ok(slot.glb.scale.y > 1, `${slot.placement.id} must be scaled up from tiny GLB units`);
    } else {
      assert.equal(slot.glb, null, `${slot.placement.id} without model must keep glb null`);
      assert.ok(slot.anchor.children.includes(slot.fallback), `${slot.placement.id} without model must keep procedural fallback`);
    }
  }
});

test('Slice 11 placements (street light + bookshelf) and procedural fallback builders', () => {
  const streetLightPlacement = PROP_PLACEMENTS.find((p) => p.id === 'newsstand_street_light');
  assert.ok(streetLightPlacement, 'PROP_PLACEMENTS must include newsstand_street_light');
  assert.equal(streetLightPlacement.kind, 'street-light');
  assert.equal(streetLightPlacement.parent, 'scene');
  assert.equal(streetLightPlacement.targetSize, 3.0);

  const bookshelfPlacement = PROP_PLACEMENTS.find((p) => p.id === 'newsstand_bookshelf');
  assert.ok(bookshelfPlacement, 'PROP_PLACEMENTS must include newsstand_bookshelf');
  assert.equal(bookshelfPlacement.kind, 'bookshelf');
  assert.equal(bookshelfPlacement.parent, 'scene');
  assert.equal(bookshelfPlacement.targetSize, 1.6);

  const THREE = createThreeStub();
  const streetLightGroup = buildProceduralStreetLight(THREE);
  const streetLightMeshes = collectNodes(streetLightGroup, (n) => n.isMesh);
  assert.ok(streetLightMeshes.length >= 2 && streetLightMeshes.length <= 4,
    `street light fallback must have 2-4 meshes, got ${streetLightMeshes.length}`);

  const bookshelfGroup = buildProceduralBookshelf(THREE);
  const bookshelfMeshes = collectNodes(bookshelfGroup, (n) => n.isMesh);
  assert.ok(bookshelfMeshes.length >= 2 && bookshelfMeshes.length <= 4,
    `bookshelf fallback must have 2-4 meshes, got ${bookshelfMeshes.length}`);
});

test('Slice 12: SEED_HOME_PADS pins seed NPCs to fixed plots and reserves them from strangers', () => {
  assert.deepEqual(SEED_HOME_PADS, { wick: 2, maren: 3, tomas: 4 });

  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const sampleManifest = {
    cottage_type: 'a-frame',
    wall_color: '#6b7d8c',
    roof_color: '#34414d',
    trim_color: '#d8cfb8',
    props: [],
  };

  assert.equal(applyPlotManifest(town, 'milo', sampleManifest), null, 'milo must never be reassigned');

  const marenCottage = applyPlotManifest(town, 'maren', sampleManifest);
  assert.ok(marenCottage);
  assert.equal(marenCottage.userData.plotNumber, 3, 'maren applied first must get plot 3');

  const strangerBefore = applyPlotManifest(town, 'stranger_early', sampleManifest);
  assert.ok(strangerBefore);
  assert.equal(strangerBefore.userData.plotNumber, 5, 'unknown handle must skip reserved seed pads');

  const wickCottage = applyPlotManifest(town, 'wick', sampleManifest);
  assert.ok(wickCottage);
  assert.equal(wickCottage.userData.plotNumber, 2, 'wick must get pinned plot 2');

  const tomasCottage = applyPlotManifest(town, 'tomas', sampleManifest);
  assert.ok(tomasCottage);
  assert.equal(tomasCottage.userData.plotNumber, 4, 'tomas must get pinned plot 4');

  const strangerAfter = applyPlotManifest(town, 'stranger', sampleManifest);
  assert.ok(strangerAfter);
  assert.equal(strangerAfter.userData.plotNumber, 6, 'next unknown handle gets next free unreserved pad');
});

test('Slice 12: adopted NPC character prop placements and procedural fallback builders', () => {
  const wickLamp = PROP_PLACEMENTS.find((p) => p.id === 'wick_oil_lamp');
  assert.ok(wickLamp, 'PROP_PLACEMENTS must include wick_oil_lamp');
  assert.equal(wickLamp.kind, 'oil-lamp');
  assert.equal(wickLamp.parent, 'scene');
  assert.equal(wickLamp.targetSize, 0.9);

  const tomasTeapot = PROP_PLACEMENTS.find((p) => p.id === 'tomas_teapot');
  assert.ok(tomasTeapot, 'PROP_PLACEMENTS must include tomas_teapot');
  assert.equal(tomasTeapot.kind, 'teapot');
  assert.equal(tomasTeapot.parent, 'scene');
  assert.equal(tomasTeapot.targetSize, 0.9);

  const THREE = createThreeStub();
  for (const [name, fn] of [
    ['oil-lamp', buildProceduralOilLamp],
    ['typewriter', buildProceduralTypewriter],
    ['teapot', buildProceduralTeapot],
  ]) {
    const group = fn(THREE);
    const meshes = collectNodes(group, (n) => n.isMesh);
    assert.ok(meshes.length >= 1 && meshes.length <= 3,
      `${name} fallback must have 1-3 meshes, got ${meshes.length}`);
  }
});

test('Slice 13: maren_typewriter is procedural-only and skipped by loadTownProps', async () => {
  const marenTypewriter = PROP_PLACEMENTS.find((p) => p.id === 'maren_typewriter');
  assert.ok(marenTypewriter, 'PROP_PLACEMENTS must include maren_typewriter');
  assert.equal(marenTypewriter.kind, 'typewriter');
  assert.equal(marenTypewriter.parent, 'scene');
  assert.equal(marenTypewriter.x, 9.49);
  assert.equal(marenTypewriter.y, 0);
  assert.equal(marenTypewriter.z, -12.42);
  assert.equal(marenTypewriter.rotY, -0.6525);
  assert.equal('model' in marenTypewriter, false, 'maren_typewriter must have no model property');

  const THREE = createThreeStub();
  const { parts } = buildTown(THREE, { loadProps: false });
  const loadedUrls = [];
  const warnings = [];
  class RecordingLoader {
    load(url, onLoad) {
      loadedUrls.push(url);
      const glbScene = new THREE.Group();
      glbScene.userData.stubBounds = { min: [-0.002, 0, -0.001], max: [0.002, 0.01, 0.001] };
      onLoad({ scene: glbScene });
    }
  }
  await loadTownProps(THREE, parts.props, {
    GLTFLoader: RecordingLoader,
    warn: (...args) => warnings.push(args.join(' ')),
  });

  assert.equal(warnings.length, 0, 'model-less placement must emit no warning');
  assert.equal(loadedUrls.length, PROP_PLACEMENTS.filter((p) => p.model).length);
  assert.equal(loadedUrls.some((u) => !u || /typewriter/i.test(u)), false, 'loader.load must never be called for maren_typewriter');

  const slot = parts.props.find((s) => s.placement.id === 'maren_typewriter');
  assert.ok(slot, 'maren_typewriter slot must exist');
  assert.equal(slot.glb, null, 'maren_typewriter slot.glb must stay null');
  assert.ok(slot.anchor.children.includes(slot.fallback), 'maren_typewriter procedural fallback must remain in anchor');
});

test('Slice 14: seed NPC wanderers and Milo ghost waypoints are layout-derived and within clearing bounds', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const { scene, parts } = town;

  for (const handle of ['wick', 'maren', 'tomas']) {
    const group = scene.children.find((c) => c.name === `avatar_${handle}`);
    assert.ok(group, `wanderer avatar_${handle} must be in scene`);
    assert.equal(parts.wanderers[handle], group, `parts.wanderers.${handle} must reference the scene group`);
    assert.equal(group.userData.role, 'npc', `${handle} wanderer must have role npc`);
    assert.equal(group.userData.handle, handle, `${handle} wanderer must have handle ${handle}`);
    const nametag = group.children.find((c) => c.name === 'nametag_sprite');
    assert.ok(nametag && nametag.isSprite, `${handle} wanderer must have nametag_sprite`);
    const expectedY = handle === 'maren' ? 1.8 : 2.3;
    assert.equal(nametag.position.y, expectedY, `${handle} wanderer nametag y must be ${expectedY}`);
    assert.equal(town._live?.avatars?.has(handle) ?? false, false, `${handle} wanderer must not be in live.avatars`);

    const plotLayout = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === SEED_HOME_PADS[handle]);
    const expectedHome = getPlotTargetPosition(plotLayout, 0);
    assert.ok(Math.hypot(group.position.x - expectedHome.x, group.position.z - expectedHome.z) < 1e-4,
      `${handle} must start at its home plot front`);
  }

  const maxR = TOWN_LAYOUT.clearingRadius - 1.5;
  for (const w of town._wander.figures) {
    assert.ok(w.waypoints.length >= 3, `${w.handle} must have at least 3 waypoints`);
    for (const wp of w.waypoints) {
      const r = Math.hypot(wp.x, wp.z);
      assert.ok(r <= maxR, `${w.handle} waypoint (${wp.x}, ${wp.z}) radius ${r} exceeds ${maxR}`);
    }
  }

  const ghostWander = town._wander.figures.find((w) => w.handle === 'milo');
  assert.ok(ghostWander, 'milo ghost must be in wander figures');
  const spot0 = parts.avatarSpots[0];
  const hasSpot0 = ghostWander.waypoints.some(
    (wp) => Math.abs(wp.x - spot0.x) < 1e-4 && Math.abs(wp.z - spot0.z) < 1e-4 && wp.y === spot0.y
  );
  assert.ok(hasSpot0, 'spot 0 must be in ghost waypoint loop');
  const spot0Wp = ghostWander.waypoints.find(
    (wp) => Math.abs(wp.x - spot0.x) < 1e-4 && Math.abs(wp.z - spot0.z) < 1e-4
  );
  for (const wp of ghostWander.waypoints) {
    assert.equal(wp.y, TOWN_LAYOUT.bandstand.height, 'every ghost waypoint must be at deck height 0.6');
    const r = Math.hypot(wp.x, wp.z);
    if (wp === spot0Wp) {
      assert.ok(r <= TOWN_LAYOUT.bandstand.radius, `spot 0 radius ${r} must be on bandstand`);
    } else {
      assert.ok(r <= 4.0, `ghost deck waypoint (${wp.x}, ${wp.z}) radius ${r} must be <= 4.0`);
      assert.ok(spot0Wp.linger > wp.linger, 'ghost must linger longest at spot 0');
    }
  }
});

test('Slice 14: wanderers move deterministically, linger, advance, and Milo returns home to spot 0', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const wickState = town._wander.figures.find((w) => w.handle === 'wick');
  const wickGroup = wickState.group;
  const startPos = { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z };

  // dt <= 0 must not move anything
  updateTownAnimations(town, 0);
  updateTownAnimations(town, -0.5);
  assert.deepEqual(
    { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z },
    startPos,
    'dt <= 0 must produce no movement'
  );

  // Step with fixed dt and verify step distance <= speed * dt + epsilon
  const dt = 0.1;
  const prev = { ...startPos };
  updateTownAnimations(town, dt);
  const moved = Math.hypot(wickGroup.position.x - prev.x, wickGroup.position.y - prev.y, wickGroup.position.z - prev.z);
  assert.ok(moved > 0, 'wick must move on positive dt');
  assert.ok(moved <= wickState.speed * dt + 1e-5, `step ${moved} exceeded speed*dt (${wickState.speed * dt})`);

  // Step until wick arrives at waypoint 1 (bandstand), lingers, and advances to waypoint 2 (newsstand)
  let arrivedAtBandstand = false;
  let advancedToNewsstand = false;
  for (let i = 0; i < 600; i++) {
    updateTownAnimations(town, 0.1);
    if (wickState.state === 'lingering' && wickState.targetIndex === 1) {
      arrivedAtBandstand = true;
    }
    if (arrivedAtBandstand && wickState.state === 'walking' && wickState.targetIndex === 2) {
      advancedToNewsstand = true;
      break;
    }
  }
  assert.ok(arrivedAtBandstand, 'wick must arrive and linger at bandstand');
  assert.ok(advancedToNewsstand, 'wick must advance toward newsstand after lingering');

  // Verify facing direction of travel within tolerance after several walking steps toward newsstand
  for (let i = 0; i < 10; i++) updateTownAnimations(town, 0.1);
  const newsstandWp = wickState.waypoints[2];
  const expectedYaw = Math.atan2(newsstandWp.x - wickGroup.position.x, newsstandWp.z - wickGroup.position.z);
  let yawDiff = Math.abs(((wickGroup.rotation.y - expectedYaw + Math.PI) % (Math.PI * 2)) - Math.PI);
  if (yawDiff > Math.PI) yawDiff = Math.abs(yawDiff - Math.PI * 2);
  assert.ok(yawDiff < 0.05, `wick rotation.y diff ${yawDiff} must face travel direction`);

  // Drive Milo's ghost through its loop until it returns to spot 0
  const ghostState = town._wander.figures.find((w) => w.handle === 'milo');
  const spot0 = town.parts.avatarSpots[0];
  let returnedHome = false;
  for (let i = 0; i < 1200; i++) {
    updateTownAnimations(town, 0.1);
    if (ghostState.targetIndex === 0 && ghostState.state === 'lingering') {
      returnedHome = true;
      break;
    }
  }
  assert.ok(returnedHome, 'milo ghost must complete loop and return to spot 0');
  assert.ok(
    Math.hypot(ghostState.group.position.x - spot0.x, ghostState.group.position.z - spot0.z) < 1e-4,
    'milo ghost must be at spot 0'
  );
  assert.equal(ghostState.group.position.y, spot0.y);
  assert.equal(town.parts.footlights[0].userData.lit, true, 'footlight 0 must remain lit');
});

test('Slice 14: wanderers yield to live presence avatars and resume from home when presence clears', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const wickState = town._wander.figures.find((w) => w.handle === 'wick');
  const wickGroup = wickState.group;
  const home = wickState.waypoints[0];

  // Move wick away from home first
  for (let i = 0; i < 20; i++) updateTownAnimations(town, 0.1);
  const awayPos = { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z };
  assert.ok(Math.hypot(awayPos.x - home.x, awayPos.z - home.z) > 0.1, 'wick should have walked away from home');

  // Live presence arrives for wick
  applyState(town, {
    presence: [{ handle: 'wick', role: 'npc', zone: 'bandstand' }],
  });
  assert.equal(town._live.avatars.has('wick'), true);

  updateTownAnimations(town, 0.1);
  assert.equal(wickGroup.visible, false, 'wick wander figure must hide when live avatar is present');
  assert.deepEqual(
    { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z },
    awayPos,
    'wick wander figure must not move while yielded'
  );

  // Live presence clears
  applyState(town, { presence: [] });
  assert.equal(town._live.avatars.has('wick'), false);

  updateTownAnimations(town, 0.1);
  assert.equal(wickGroup.visible, true, 'wick wander figure must be visible again after presence clears');
  assert.ok(
    Math.hypot(wickGroup.position.x - home.x, wickGroup.position.z - home.z) < 1e-4,
    'wick wander figure must reset to its home waypoint when resuming'
  );
});

test('Slice 15: newsstand paper stack sits on a wood shelf with two support brackets', () => {
  const THREE = createThreeStub();
  const { parts } = buildTown(THREE, { loadProps: false });
  const newsstand = parts.newsstand;
  const meshes = collectNodes(newsstand, (n) => n.isMesh);

  const booth = meshes.find((m) => m.geometry?.parameters?.width === 2.2);
  const papers = meshes.find((m) => m.material?.color === '#ebe4d1');
  const shelf = meshes.find((m) => m.name === 'newsstand_papers_shelf');
  const bracketL = meshes.find((m) => m.name === 'newsstand_papers_bracket_l');
  const bracketR = meshes.find((m) => m.name === 'newsstand_papers_bracket_r');

  assert.ok(booth, 'newsstand booth mesh must exist');
  assert.ok(papers, 'newsstand papers mesh must exist');
  assert.ok(shelf, 'newsstand_papers_shelf mesh must exist');
  assert.ok(bracketL, 'newsstand_papers_bracket_l mesh must exist');
  assert.ok(bracketR, 'newsstand_papers_bracket_r mesh must exist');

  assert.equal(shelf.material.color, booth.material.color, 'shelf must use booth wood color');
  assert.equal(bracketL.material.color, booth.material.color, 'left bracket must use booth wood color');
  assert.equal(bracketR.material.color, booth.material.color, 'right bracket must use booth wood color');

  const papersP = papers.geometry.parameters;
  const shelfP = shelf.geometry.parameters;
  const boothP = booth.geometry.parameters;

  const papersBottomY = papers.position.y - papersP.height / 2;
  const shelfTopY = shelf.position.y + shelfP.height / 2;
  const shelfBottomY = shelf.position.y - shelfP.height / 2;
  assert.ok(
    Math.abs(shelfTopY - papersBottomY) <= 0.03,
    `shelf top (${shelfTopY}) must meet papers bottom (${papersBottomY}) within 0.03m`
  );

  assert.ok(shelfP.width > papersP.width, 'shelf must be wider than papers');
  assert.ok(shelfP.depth > papersP.depth, 'shelf must be deeper than papers');
  assert.ok(
    shelf.position.x - shelfP.width / 2 < papers.position.x - papersP.width / 2 &&
    shelf.position.x + shelfP.width / 2 > papers.position.x + papersP.width / 2,
    'shelf X footprint must cover papers X footprint'
  );
  assert.ok(
    shelf.position.z - shelfP.depth / 2 < papers.position.z - papersP.depth / 2 &&
    shelf.position.z + shelfP.depth / 2 > papers.position.z + papersP.depth / 2,
    'shelf Z footprint must cover papers Z footprint'
  );

  const boothFrontZ = booth.position.z + boothP.depth / 2;
  for (const [label, b] of [['left', bracketL], ['right', bracketR]]) {
    const bP = b.geometry.parameters;
    const bTopY = b.position.y + bP.height / 2;
    const bBackZ = b.position.z - bP.depth / 2;
    assert.ok(
      Math.abs(bTopY - shelfBottomY) <= 0.01,
      `${label} bracket top (${bTopY}) must touch shelf underside (${shelfBottomY})`
    );
    assert.ok(
      Math.abs(bBackZ - boothFrontZ) <= 0.02,
      `${label} bracket back (${bBackZ}) must touch booth front face (${boothFrontZ})`
    );
    assert.ok(
      b.position.x >= shelf.position.x - shelfP.width / 2 &&
      b.position.x <= shelf.position.x + shelfP.width / 2,
      `${label} bracket must sit under the shelf width`
    );
  }
  assert.ok(
    bracketL.position.x < shelf.position.x && bracketR.position.x > shelf.position.x,
    'brackets must be positioned on opposite sides under the shelf'
  );
});

test('Slice 36: signpost text wraps deterministically without measureText', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const charBudget = (size) => Math.floor(480 / (0.6 * size));

  // 1. "OPEN PLOT #1" stays exactly 1 line at 28 px
  assert.ok(applyPlotManifest(town, 'signpost-open', { ...MILO_REBUILD_MANIFEST, signpost_text: 'OPEN PLOT #1' }));
  const openSign = collectNodes(town.scene, (n) => n.name === 'cottage_signpost' && n.userData?.signpostText === 'OPEN PLOT #1')[0];
  assert.ok(openSign, 'cottage_signpost with OPEN PLOT #1 must exist');
  assert.deepEqual(openSign.userData.signpostLines, ['OPEN PLOT #1']);
  assert.equal(openSign.userData.signpostFontSize, 28);

  // 2. "Milo — Ghostlight Cottage (rebuilt)" wraps to 2 lines at 28 px
  const miloText = 'Milo — Ghostlight Cottage (rebuilt)';
  assert.ok(applyPlotManifest(town, 'signpost-milo', { ...MILO_REBUILD_MANIFEST, signpost_text: miloText }));
  let sign = collectNodes(town.scene, (n) => n.userData?.signpostText === miloText)[0];
  assert.ok(sign, 'Milo signpost must exist after applyPlotManifest');
  assert.equal(sign.userData.signpostFontSize, 28);
  assert.equal(sign.userData.signpostLines.length, 2);
  assert.ok(sign.userData.signpostLines.every((l) => l.length > 0 && l.length <= 28));
  assert.equal(sign.userData.signpostLines.join(' ').replace(/\s+/g, ' '), miloText);

  // 3. 120-char signpost text fits in <= 3 lines within its font-size char budget
  const longText = 'The Grand Ghostlight Observatory & Archive of Midnight Cartography, Field Notes, Lanterns, and Quiet Tea Studies';
  const worstCase120 = (longText + ' ' + longText).slice(0, 120);
  assert.ok(applyPlotManifest(town, 'signpost-long', { ...MILO_REBUILD_MANIFEST, signpost_text: worstCase120 }));
  sign = collectNodes(town.scene, (n) => n.userData?.signpostText === worstCase120)[0];
  assert.ok(sign, '120-char signpost must exist');
  assert.ok([20, 24, 28].includes(sign.userData.signpostFontSize));
  assert.ok(sign.userData.signpostLines.length >= 1 && sign.userData.signpostLines.length <= 3);
  const longBudget = charBudget(sign.userData.signpostFontSize);
  assert.ok(
    sign.userData.signpostLines.every((l) => l.length > 0 && l.length <= longBudget),
    `every line must be non-empty and <= ${longBudget} chars`
  );

  // 4. Single 40-char word with no spaces splits by character and fits in <= 3 lines
  const word40 = 'A'.repeat(40);
  assert.ok(applyPlotManifest(town, 'signpost-word40', { ...MILO_REBUILD_MANIFEST, signpost_text: word40 }));
  sign = collectNodes(town.scene, (n) => n.userData?.signpostText === word40)[0];
  assert.ok(sign, '40-char word signpost must exist');
  assert.ok([20, 24, 28].includes(sign.userData.signpostFontSize));
  assert.ok(sign.userData.signpostLines.length >= 1 && sign.userData.signpostLines.length <= 3);
  const wordBudget = charBudget(sign.userData.signpostFontSize);
  assert.ok(
    sign.userData.signpostLines.every((l) => l.length > 0 && l.length <= wordBudget),
    `split word lines must be non-empty and <= ${wordBudget} chars`
  );
  assert.equal(sign.userData.signpostLines.join(''), word40);
});

test('Perimeter trees stand on the clearing ground: trunks inside clearingRadius, bases at y=0', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const trunks = collectNodes(town.scene, (n) => n.name === 'perimeter_tree_trunks')[0];
  assert.ok(trunks, 'perimeter_tree_trunks must exist');
  assert.equal(trunks.count, 18, 'there must be 18 perimeter trees');
  const trunkHalfHeight = 2.2 / 2; // CylinderGeometry height in addPerimeterScenery
  for (let i = 0; i < trunks.count; i++) {
    const e = trunks.matrices[i].elements;
    const r = Math.hypot(e[12], e[14]);
    assert.ok(r < TOWN_LAYOUT.clearingRadius, `tree ${i} trunk radius ${r} must be inside clearingRadius ${TOWN_LAYOUT.clearingRadius}`);
    // Trunk center y is 1.1 * scale and half-height is 1.1 * scale, so the base sits at y=0.
    const baseY = e[13] - trunkHalfHeight * e[5];
    assert.ok(Math.abs(baseY) < 1e-9, `tree ${i} trunk base must sit at y=0, got ${baseY}`);
  }
});

test('Ghostlight Inn group has sign, door, chimney, and >= 6 emissive warm windows', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const inn = town.parts.inn;
  assert.ok(inn, 'town.parts.inn must exist');
  assert.equal(inn.name, 'ghostlight_inn');
  assert.equal(inn.userData.clickable, true);
  assert.equal(inn.userData.kind, 'inn');
  assert.equal(inn.userData.label, 'Ghostlight Inn');

  const sign = collectNodes(inn, (n) => n.name === 'inn_signpost')[0];
  const door = collectNodes(inn, (n) => n.name === 'inn_door')[0];
  const chimney = collectNodes(inn, (n) => n.name === 'inn_chimney')[0];
  assert.ok(sign, 'inn_signpost must exist');
  assert.ok(door && door.isMesh, 'inn_door mesh must exist');
  assert.ok(chimney && chimney.isMesh, 'inn_chimney mesh must exist');

  const windows = collectNodes(inn, (n) => n.isMesh && /^inn_window_\d+$/.test(n.name));
  assert.ok(windows.length >= 6, `Expected >= 6 inn windows, got ${windows.length}`);
  for (const win of windows) {
    assert.equal(win.material.emissive, '#ffbe5c', `${win.name} must have warm emissive #ffbe5c`);
    assert.ok(win.material.emissiveIntensity > 0, `${win.name} must have emissiveIntensity > 0`);
  }
});

test('Ghostlight Inn placement is inside clearingRadius with clear separation from plots, bandstand, newsstand, and gate', () => {
  const inn = TOWN_LAYOUT.inn;
  const innFootprintRadius = Math.hypot(4.6 / 2, 3.6 / 2); // half-diagonal of 4.6 x 3.6m footprint (~2.92m)
  const distFromOrigin = Math.hypot(inn.x, inn.z);
  assert.ok(
    distFromOrigin + innFootprintRadius < TOWN_LAYOUT.clearingRadius,
    `Inn outer radius (${(distFromOrigin + innFootprintRadius).toFixed(2)}) must be inside clearingRadius (${TOWN_LAYOUT.clearingRadius})`
  );

  // Clearance from bandstand (radius 4.5 + inn footprint)
  const bandstandDist = Math.hypot(inn.x - TOWN_LAYOUT.bandstand.x, inn.z - TOWN_LAYOUT.bandstand.z);
  assert.ok(
    bandstandDist > TOWN_LAYOUT.bandstand.radius + innFootprintRadius + 2,
    `Inn too close to bandstand: ${bandstandDist.toFixed(2)}m`
  );

  // Clearance from every resident plot (plot pad radius ~3 + inn footprint)
  for (const plot of TOWN_LAYOUT.plots) {
    const plotDist = Math.hypot(inn.x - plot.x, inn.z - plot.z);
    assert.ok(
      plotDist > 3.0 + innFootprintRadius + 2,
      `Inn too close to plot ${plot.plotNumber}: ${plotDist.toFixed(2)}m`
    );
  }

  // Clearance from newsstand and gate
  const newsstandDist = Math.hypot(inn.x - TOWN_LAYOUT.newsstand.x, inn.z - TOWN_LAYOUT.newsstand.z);
  assert.ok(newsstandDist > 2.0 + innFootprintRadius + 2, `Inn too close to newsstand: ${newsstandDist.toFixed(2)}m`);

  const gateDist = Math.hypot(inn.x - TOWN_LAYOUT.gate.x, inn.z - TOWN_LAYOUT.gate.z);
  assert.ok(gateDist > 2.5 + innFootprintRadius + 2, `Inn too close to gate: ${gateDist.toFixed(2)}m`);
});

test('Ghostlight Inn signpost text is GHOSTLIGHT INN and wraps via shared wrapper', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const inn = town.parts.inn;
  assert.equal(inn.userData.signpostText, 'GHOSTLIGHT INN');
  const sign = collectNodes(inn, (n) => n.name === 'inn_signpost')[0];
  assert.ok(sign, 'inn_signpost must exist');
  assert.equal(sign.userData.signpostText, 'GHOSTLIGHT INN');
  assert.ok(Array.isArray(sign.userData.signpostLines) && sign.userData.signpostLines.length >= 1);
  assert.equal(sign.userData.signpostLines.join(' '), 'GHOSTLIGHT INN');
});

test('Ghostlight Inn book page exists, is static/safe, and index.html overlay URL resolves', async () => {
  const innHtmlPath = path.join(__dirname, 'inn', 'index.html');
  const [innHtml, indexHtml, townJs] = await Promise.all([
    fs.readFile(innHtmlPath, 'utf8'),
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, 'town.js'), 'utf8'),
  ]);

  assert.match(innHtml, /<meta\s+charset=["']?utf-8["']?\s*>/i, 'inn/index.html must declare utf-8 charset');
  assert.match(
    innHtml,
    /<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>/i,
    'inn/index.html must declare responsive viewport meta'
  );
  assert.ok(!/<script\b/i.test(innHtml), 'inn/index.html must not contain <script> tags');
  assert.ok(!/https?:\/\//i.test(innHtml), 'inn/index.html must not contain external http(s):// URLs');
  assert.ok(!new RegExp(`camp${'fire'}`, 'i').test(innHtml), 'inn/index.html must not contain banned term');

  assert.match(
    indexHtml,
    /import\s*\{[^}]*\bresolveInnOverlayContent\b[^}]*\}\s*from\s*['"]\.\/town\.js[^'"]*['"]/,
    'index.html must import resolveInnOverlayContent from town.js'
  );
  assert.match(indexHtml, /function\s+openInnOverlay\s*\(/, 'index.html must define openInnOverlay()');
  assert.match(
    indexHtml,
    /kind\s*===\s*['"]inn['"][\s\S]{0,120}?openInnOverlay\s*\(/,
    'index.html handleCanvasClick kind === "inn" branch must call openInnOverlay()'
  );

  const fnMatch = townJs.match(/export\s+async\s+function\s+resolveInnOverlayContent\b[\s\S]*?^}/m);
  assert.ok(fnMatch, 'town.js must export resolveInnOverlayContent');
  const urlMatch = fnMatch[0].match(/['"](inn\/index\.html)['"]/);
  assert.ok(urlMatch, 'town.js resolveInnOverlayContent must contain static fallback URL inn/index.html');
  const stat = await fs.stat(path.join(__dirname, urlMatch[1]));
  assert.ok(stat.isFile(), 'inn/index.html overlay target must resolve to a file on disk');
});

test('Slice 55 exports stepGlide and pinchFov', () => {
  assert.equal(typeof stepGlide, 'function', 'town.js must export stepGlide');
  assert.equal(typeof pinchFov, 'function', 'town.js must export pinchFov');
});

test('stepGlide moves toward target by speed * dt, arrives within arriveDist without overshoot, clamps maxRadius, and handles dt = 0', () => {
  const zeroDt = stepGlide({ x: 3, z: -4 }, { x: 10, z: 10 }, 0);
  assert.deepEqual(zeroDt, { x: 3, z: -4, arrived: false });

  const step1 = stepGlide({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.2);
  assert.equal(step1.arrived, false);
  assert.ok(Math.abs(step1.x - 1.5) < 1e-9, `expected x=1.5, got ${step1.x}`);
  assert.ok(Math.abs(step1.z) < 1e-9, `expected z=0, got ${step1.z}`);

  // Snap on arrival within arriveDist (0.3) without overshooting
  const near = stepGlide({ x: 9.0, z: 0 }, { x: 10, z: 0 }, 0.1);
  assert.deepEqual(near, { x: 10, z: 0, arrived: true });

  const noOvershoot = stepGlide({ x: 9.9, z: 0 }, { x: 10, z: 0 }, 1.0);
  assert.deepEqual(noOvershoot, { x: 10, z: 0, arrived: true });

  // Clamp target beyond maxRadius
  const clamped = stepGlide({ x: 0, z: 0 }, { x: 40, z: 0 }, 10);
  assert.equal(clamped.arrived, true);
  assert.ok(Math.abs(clamped.x - 28.5) < 1e-9, `expected x=28.5, got ${clamped.x}`);
  assert.ok(Math.abs(clamped.z) < 1e-9, `expected z=0, got ${clamped.z}`);
});

test('pinchFov zooms in/out, clamps to [40, 85], and returns startFov for currentDist <= 0', () => {
  // Pinch open (currentDist > startDist) -> smaller FOV (zoom in)
  const zoomedIn = pinchFov(65, 100, 130);
  assert.ok(zoomedIn < 65 && zoomedIn >= 40, `expected zoomedIn in [40, 65), got ${zoomedIn}`);

  // Pinch close (currentDist < startDist) -> larger FOV (zoom out)
  const zoomedOut = pinchFov(65, 100, 80);
  assert.ok(zoomedOut > 65 && zoomedOut <= 85, `expected zoomedOut in (65, 85], got ${zoomedOut}`);

  // Clamp bounds
  assert.equal(pinchFov(65, 100, 500), 40);
  assert.equal(pinchFov(65, 100, 10), 85);

  // Non-positive or non-finite currentDist
  assert.equal(pinchFov(65, 100, 0), 65);
  assert.equal(pinchFov(65, 100, -5), 65);
  assert.equal(pinchFov(65, 100, Number.NaN), 65);
});

test('Slice 56 mobile overlay CSS @media (max-width: 640px) rules in index.html and Gazette viewport regression guard', async () => {
  const [indexHtml, gazetteHtml] = await Promise.all([
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, 'gazette', 'issue-001.html'), 'utf8'),
  ]);

  const mediaMatch = indexHtml.match(/@media\s*\(\s*max-width:\s*640px\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*<\/style>/);
  assert.ok(mediaMatch, 'index.html must contain a @media (max-width: 640px) block');
  const mediaBlock = mediaMatch[1];

  assert.match(
    mediaBlock,
    /#plot-overlay-close\s*\{[^}]*min-height:\s*44px\b/,
    '@media (max-width: 640px) must set #plot-overlay-close min-height: 44px'
  );
  assert.match(
    mediaBlock,
    /#prompt-book\s*\{[^}]*top:\s*52px\b/,
    '@media (max-width: 640px) must move #prompt-book to top: 52px'
  );
  assert.match(
    mediaBlock,
    /#title-bar\s*\{[^}]*text-overflow:\s*ellipsis\b/,
    '@media (max-width: 640px) must ellipsize #title-bar'
  );
  assert.match(
    mediaBlock,
    /#footer-bar\s*\{[^}]*flex-wrap:\s*wrap\b/,
    '@media (max-width: 640px) must wrap #footer-bar'
  );
  assert.match(
    mediaBlock,
    /#info-strip\s*\{[^}]*bottom:\s*72px\b/,
    '@media (max-width: 640px) must set #info-strip bottom: 72px'
  );

  assert.match(
    gazetteHtml,
    /<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>/i,
    'gazette/issue-001.html must retain responsive viewport meta'
  );
});

test('Slice 57 phone-first landing CTA in #title-bar and footer regression guard in index.html', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');

  assert.match(
    indexHtml,
    /#title-bar\s*\{[^}]*display:\s*flex\b/,
    '#title-bar must use flex layout (display: flex)'
  );

  const titleBarMatch = indexHtml.match(/<header\s+id=["']title-bar["'][^>]*>([\s\S]*?)<\/header>/i);
  assert.ok(titleBarMatch, 'index.html must contain <header id="title-bar">');
  assert.match(
    titleBarMatch[1],
    /<a\b[^>]*id=["']move-in-cta["'][^>]*href=["']move-in\.html["'][^>]*>Move in →<\/a>|<a\b[^>]*href=["']move-in\.html["'][^>]*id=["']move-in-cta["'][^>]*>Move in →<\/a>/i,
    '#title-bar must contain #move-in-cta anchor linking to move-in.html'
  );

  const mediaMatch = indexHtml.match(/@media\s*\(\s*max-width:\s*640px\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*<\/style>/);
  assert.ok(mediaMatch, 'index.html must contain a @media (max-width: 640px) block');
  assert.match(
    mediaMatch[1],
    /#move-in-cta\s*\{[^}]*min-height:\s*44px\b/,
    '@media (max-width: 640px) must set #move-in-cta min-height: 44px'
  );

  const footerMatch = indexHtml.match(/<footer\s+id=["']footer-bar["'][^>]*>([\s\S]*?)<\/footer>/i);
  assert.ok(footerMatch, 'index.html must contain <footer id="footer-bar">');
  assert.match(
    footerMatch[1],
    /<a\s+href=["']move-in\.html["'][^>]*>Move in →<\/a>/i,
    '#footer-bar must retain the "Move in →" link'
  );
});

test('Slice 58 wires gate click to openGuestbookOverlay and resolveGuestbookOverlayContent', async () => {
  const [indexHtml, townJs] = await Promise.all([
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, 'town.js'), 'utf8'),
  ]);

  assert.match(
    indexHtml,
    /import\s*\{[^}]*\bresolveGuestbookOverlayContent\b[^}]*\}\s*from\s*['"]\.\/town\.js[^'"]*['"]/,
    'index.html must import resolveGuestbookOverlayContent from town.js'
  );
  assert.match(
    indexHtml,
    /function\s+openGuestbookOverlay\s*\([\s\S]*?plotOverlayTitle\.textContent\s*=\s*['"]Town Gate Guestbook['"][\s\S]*?plotIframe\.setAttribute\(\s*['"]sandbox['"]\s*,\s*['"]['"]\s*\)/,
    'index.html must define openGuestbookOverlay() setting title "Town Gate Guestbook" and sandbox="" on plotIframe'
  );
  assert.match(
    indexHtml,
    /kind\s*===\s*['"]gate['"][\s\S]{0,120}?openGuestbookOverlay\s*\(/,
    'index.html handleCanvasClick kind === "gate" branch must call openGuestbookOverlay()'
  );
  assert.equal(townJs.includes('fetch('), false, 'town.js must not call fetch( directly');
});

test('Slice 74: createCottage attaches porch deck in all 4 styles, lifts porch props by 0.18, and lifts signpost to y=0.18', () => {
  const THREE = createThreeStub();

  const variants = [
    { label: 'gable', manifest: { cottage: 'gable', signpost_text: 'Gable Home' }, options: {} },
    { label: 'cabin', manifest: { cottage: 'cabin', signpost_text: 'Cabin Home' }, options: {} },
    { label: 'tower', manifest: { cottage: 'tower', signpost_text: 'Tower Home' }, options: {} },
    {
      label: 'concept',
      manifest: {
        ...MILO_REBUILD_MANIFEST,
        props: [
          ...MILO_REBUILD_MANIFEST.props,
          { kind: 'rug', x: 0, y: 0, z: 0.9, rot_y: 0, color: '#9c5a2c' },
        ],
      },
      options: { conceptCottage: true },
    },
  ];

  for (const v of variants) {
    const cottage = createCottage(THREE, v.manifest, v.options);
    const deck = collectNodes(cottage, (n) => n.name === 'cottage_porch_deck')[0];
    assert.ok(deck, `${v.label} cottage must have cottage_porch_deck`);
    assert.equal(deck.geometry.type, 'BoxGeometry');
    assert.equal(deck.geometry.parameters.width, 4.8);
    assert.equal(deck.geometry.parameters.height, 0.18);
    assert.equal(deck.geometry.parameters.depth, 1.2);
    assert.ok(Math.abs(deck.position.y + deck.geometry.parameters.height / 2 - 0.18) < 1e-12, `${v.label} deck top y = 0.18`);
    assert.ok(Math.abs(deck.position.z - deck.geometry.parameters.depth / 2 - 2.3) < 1e-12, `${v.label} deck z starts at 2.3`);
    assert.ok(Math.abs(deck.position.z + deck.geometry.parameters.depth / 2 - 3.5) < 1e-12, `${v.label} deck z ends at 3.5`);
    assert.equal(deck.material.color, '#6b492b');

    const sign = collectNodes(cottage, (n) => n.name === 'cottage_signpost')[0];
    assert.ok(sign, `${v.label} cottage must have cottage_signpost`);
    assert.ok(Math.abs(sign.position.y - 0.18) < 1e-12, `${v.label} signpost y = 0.18`);

    const trim = collectNodes(cottage, (n) => n.name === 'cottage_porch_trim')[0];
    assert.ok(trim, `${v.label} cottage must have cottage_porch_trim`);
    const trimMeshes = collectNodes(trim, (n) => n.isMesh);
    assert.equal(trimMeshes.length, 7, `${v.label} porch trim must add exactly 7 meshes`);

    const posts = collectNodes(trim, (n) => n.name === 'cottage_porch_post')
      .sort((a, b) => a.position.x - b.position.x);
    assert.equal(posts.length, 2, `${v.label} porch trim must have 2 posts`);
    for (const [idx, expectedX] of [[-2.3, 0], [2.3, 1]].map(([x, i]) => [i, x])) {
      const post = posts[idx];
      assert.equal(post.geometry.type, 'BoxGeometry');
      assert.equal(post.geometry.parameters.width, 0.12);
      assert.equal(post.geometry.parameters.height, 1.82);
      assert.equal(post.geometry.parameters.depth, 0.12);
      assert.equal(post.material.color, '#6b492b');
      assert.ok(Math.abs(post.position.x - expectedX) < 1e-12, `${v.label} post x = ${expectedX}`);
      assert.ok(Math.abs(post.position.y - 1.09) < 1e-12, `${v.label} post center y = 1.09`);
      assert.ok(Math.abs(post.position.y - post.geometry.parameters.height / 2 - 0.18) < 1e-12, `${v.label} post bottom y = 0.18`);
      assert.ok(Math.abs(post.position.y + post.geometry.parameters.height / 2 - 2.0) < 1e-12, `${v.label} post top y = 2.0`);
      assert.ok(Math.abs(post.position.z - 3.44) < 1e-12, `${v.label} post z = 3.44`);
    }

    const step = collectNodes(trim, (n) => n.name === 'cottage_porch_step')[0];
    assert.ok(step, `${v.label} porch trim must have cottage_porch_step`);
    assert.equal(step.geometry.type, 'BoxGeometry');
    assert.equal(step.geometry.parameters.width, 1.2);
    assert.equal(step.geometry.parameters.height, 0.09);
    assert.equal(step.geometry.parameters.depth, 0.3);
    assert.equal(step.material.color, '#6b492b');
    assert.ok(Math.abs(step.position.x) < 1e-12, `${v.label} step center x = 0`);
    assert.ok(Math.abs(step.position.x - step.geometry.parameters.width / 2 - (-0.6)) < 1e-12, `${v.label} step x min = -0.6`);
    assert.ok(Math.abs(step.position.x + step.geometry.parameters.width / 2 - 0.6) < 1e-12, `${v.label} step x max = 0.6`);
    assert.ok(Math.abs(step.position.y + step.geometry.parameters.height / 2 - 0.09) < 1e-12, `${v.label} step top y = 0.09`);
    assert.ok(Math.abs(step.position.z - step.geometry.parameters.depth / 2 - 3.5) < 1e-12, `${v.label} step z starts at 3.5`);
    assert.ok(Math.abs(step.position.z + step.geometry.parameters.depth / 2 - 3.8) < 1e-12, `${v.label} step z ends at 3.8`);

    const rails = collectNodes(trim, (n) => n.name === 'cottage_porch_rail')
      .sort((a, b) => a.position.x - b.position.x);
    assert.equal(rails.length, 2, `${v.label} porch trim must have 2 front rails`);
    for (const [idx, expectedX, xMin, xMax] of [[0, -1.5, -2.3, -0.7], [1, 1.5, 0.7, 2.3]]) {
      const rail = rails[idx];
      assert.equal(rail.geometry.type, 'BoxGeometry');
      assert.equal(rail.geometry.parameters.width, 1.6);
      assert.equal(rail.geometry.parameters.height, 0.08);
      assert.equal(rail.geometry.parameters.depth, 0.08);
      assert.equal(rail.material.color, '#6b492b');
      assert.ok(Math.abs(rail.position.x - expectedX) < 1e-12, `${v.label} rail x = ${expectedX}`);
      assert.ok(Math.abs(rail.position.x - rail.geometry.parameters.width / 2 - xMin) < 1e-12, `${v.label} rail x min = ${xMin}`);
      assert.ok(Math.abs(rail.position.x + rail.geometry.parameters.width / 2 - xMax) < 1e-12, `${v.label} rail x max = ${xMax}`);
      assert.ok(Math.abs(rail.position.y - 0.95) < 1e-12, `${v.label} rail center y = 0.95`);
      assert.ok(Math.abs(rail.position.y - rail.geometry.parameters.height / 2 - 0.91) < 1e-12, `${v.label} rail underside y = 0.91`);
      assert.ok(Math.abs(rail.position.y + rail.geometry.parameters.height / 2 - 0.99) < 1e-12, `${v.label} rail top y = 0.99`);
      assert.ok(Math.abs(rail.position.z - 3.44) < 1e-12, `${v.label} rail z = 3.44`);
    }
    assert.ok(Math.abs((rails[1].position.x - rails[1].geometry.parameters.width / 2) - (rails[0].position.x + rails[0].geometry.parameters.width / 2) - 1.4) < 1e-12, `${v.label} rail gap = 1.4`);

    const balusters = collectNodes(trim, (n) => n.name === 'cottage_porch_baluster')
      .sort((a, b) => a.position.x - b.position.x);
    assert.equal(balusters.length, 2, `${v.label} porch trim must have 2 balusters`);
    for (const [idx, expectedX] of [[0, -1.5], [1, 1.5]]) {
      const baluster = balusters[idx];
      assert.equal(baluster.geometry.type, 'BoxGeometry');
      assert.equal(baluster.geometry.parameters.width, 0.05);
      assert.equal(baluster.geometry.parameters.height, 0.73);
      assert.equal(baluster.geometry.parameters.depth, 0.05);
      assert.equal(baluster.material.color, '#6b492b');
      assert.ok(Math.abs(baluster.position.x - expectedX) < 1e-12, `${v.label} baluster x = ${expectedX}`);
      assert.ok(Math.abs(baluster.position.y - 0.545) < 1e-12, `${v.label} baluster center y = 0.545`);
      assert.ok(Math.abs(baluster.position.y - baluster.geometry.parameters.height / 2 - 0.18) < 1e-12, `${v.label} baluster bottom y = 0.18`);
      assert.ok(Math.abs(baluster.position.y + baluster.geometry.parameters.height / 2 - 0.91) < 1e-12, `${v.label} baluster top y = 0.91`);
      assert.ok(Math.abs(baluster.position.z - 3.44) < 1e-12, `${v.label} baluster z = 3.44`);
    }
  }

  const conceptCottage = createCottage(THREE, variants[3].manifest, variants[3].options);
  const desk = collectNodes(conceptCottage, (n) => n.name === 'prop_desk')[0];
  const kettle = collectNodes(conceptCottage, (n) => n.name === 'prop_tea_kettle')[0];
  const rug = collectNodes(conceptCottage, (n) => n.name === 'prop_rug')[0];
  assert.ok(Math.abs(desk.position.y - 0.36 - 0.18) < 1e-12, 'desk bottom lifted to 0.18');
  assert.ok(Math.abs(kettle.position.y - 0.12 - 0.96) < 1e-12, 'kettle bottom lifted to 0.96');
  assert.ok(Math.abs(rug.position.y - 0.02 - 0.18) < 1e-12, 'rug bottom lifted to 0.18');
});

test('Slice 78: town notice board geometry, clearances, exact notice texts, and waypoint distance', async () => {
  assert.deepEqual(TOWN_LAYOUT.noticeBoard, { x: -6, y: 0, z: 14 });

  const THREE = createThreeStub();
  const built = buildTown(THREE);
  const board = collectNodes(built.scene, (n) => n.name === 'town_notice_board')[0];
  assert.ok(board, 'town_notice_board group must exist in built town');
  assert.equal(board.position.x, -6);
  assert.equal(board.position.y, 0);
  assert.equal(board.position.z, 14);
  assert.ok(Math.abs(board.rotation.y - Math.atan2(6, -14)) < 1e-12, 'board must face gate path');
  assert.equal(board.userData?.clickable, true, 'notice board must be clickable (slice 79)');
  assert.equal(board.userData?.kind, 'notice_board', 'notice board userData.kind must be notice_board (slice 79)');
  assert.equal(board.userData?.label, 'Notice Board', 'notice board userData.label must be Notice Board (slice 79)');

  const meshes = collectNodes(board, (n) => n.isMesh);
  assert.equal(meshes.length, 6, 'notice board must have exactly 6 meshes');

  const posts = collectNodes(board, (n) => n.name === 'notice_board_post').sort((a, b) => a.position.x - b.position.x);
  assert.equal(posts.length, 2, 'notice board must have 2 posts');
  for (const [idx, expectedX] of [[0, -0.95], [1, 0.95]]) {
    const post = posts[idx];
    assert.equal(post.geometry.type, 'BoxGeometry');
    assert.equal(post.geometry.parameters.width, 0.12);
    assert.equal(post.geometry.parameters.height, 2.2);
    assert.equal(post.geometry.parameters.depth, 0.12);
    assert.equal(post.material.color, '#6b492b');
    assert.equal(post.position.x, expectedX);
    assert.equal(post.position.y, 1.1);
    assert.equal(post.position.z, 0);
  }

  const panel = collectNodes(board, (n) => n.name === 'notice_board_panel')[0];
  assert.ok(panel, 'notice_board_panel must exist');
  assert.equal(panel.geometry.type, 'BoxGeometry');
  assert.equal(panel.geometry.parameters.width, 2.2);
  assert.equal(panel.geometry.parameters.height, 1.3);
  assert.equal(panel.geometry.parameters.depth, 0.08);
  assert.equal(panel.position.x, 0);
  assert.equal(panel.position.y, 1.35);
  assert.equal(panel.position.z, 0);

  const expectedPapers = [
    ['notice_board_paper_gazette', -0.60],
    ['notice_board_paper_inn', 0],
    ['notice_board_paper_gate', 0.60],
  ];
  const panelFrontZ = panel.position.z + panel.geometry.parameters.depth / 2;
  const rightPostInnerX = posts[1].position.x - posts[1].geometry.parameters.width / 2;
  for (const [name, expectedX] of expectedPapers) {
    const paper = collectNodes(board, (n) => n.name === name)[0];
    assert.ok(paper, `${name} must exist`);
    assert.equal(paper.geometry.type, 'BoxGeometry');
    assert.equal(paper.geometry.parameters.width, 0.5);
    assert.equal(paper.geometry.parameters.height, 0.7);
    assert.equal(paper.geometry.parameters.depth, 0.02);
    assert.equal(paper.position.x, expectedX);
    assert.equal(paper.position.y, 1.35);
    assert.equal(paper.position.z, 0.06);

    const paperBackZ = paper.position.z - paper.geometry.parameters.depth / 2;
    assert.ok(Math.abs((paperBackZ - panelFrontZ) - 0.01) < 1e-12, `${name} must have 0.01 z-gap from panel front`);
    const paperOuterX = Math.abs(paper.position.x) + paper.geometry.parameters.width / 2;
    assert.ok(paperOuterX < rightPostInnerX, `${name} outer edge ${paperOuterX} must be clear of post inner face ${rightPostInnerX}`);
    assert.ok(Math.abs((rightPostInnerX - 0.85) - 0.04) < 1e-12, 'outer paper edge (0.85) clear of post inner face (0.89) by 0.04');
  }

  const townSrc = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  const expectedTexts = [
    ['GAZETTE #2', 'Issue #2 is out —', 'read it at the', 'newsstand.'],
    ['THE INN', 'Rooms for short', 'stays — ask at', 'the tavern.'],
    ['SOCIAL GATE', 'Plots are free,', 'no upkeep — yours', 'outright. Bring a', 'friend.'],
  ];
  const match = townSrc.match(/const NOTICE_BOARD_PAPERS = \[([\s\S]*?)\];/);
  assert.ok(match, 'NOTICE_BOARD_PAPERS must exist in town.js');
  for (const lines of expectedTexts) {
    for (const line of lines) {
      assert.ok(line.length <= 21, `Notice line "${line}" exceeds 21 chars (${line.length})`);
    }
    const serialized = lines.map((l) => `'${l}'`).join(', ');
    assert.ok(match[1].includes(serialized), `town.js must include exact notice lines [${serialized}]`);
  }

  let minDist = Infinity;
  for (const fig of built._wander.figures) {
    for (const wp of fig.waypoints) {
      const d = Math.hypot(wp.x - (-6), wp.z - 14);
      if (d < minDist) minDist = d;
    }
  }
  assert.ok(minDist > 11, `Nearest wander waypoint to (-6, 14) must be > 11 m away, got ${minDist.toFixed(3)}`);
});

test('Slice 79: buildNoticeBoardOverlayHtml renders all three notices, viewport meta, no script or http URLs', () => {
  const html = buildNoticeBoardOverlayHtml();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.match(html, /<h1>Notice Board<\/h1>/);
  assert.ok(!/<script\b/i.test(html), 'overlay HTML must contain no <script>');
  assert.ok(!/https?:\/\//i.test(html), 'overlay HTML must contain no external http URLs');

  const expectedNotices = [
    ['GAZETTE #2', 'Issue #2 is out — read it at the newsstand.'],
    ['THE INN', 'Rooms for short stays — ask at the tavern.'],
    ['SOCIAL GATE', 'Plots are free, no upkeep — yours outright. Bring a friend.'],
  ];
  for (const [title, body] of expectedNotices) {
    assert.ok(html.includes(title), `overlay HTML must include title "${title}"`);
    assert.ok(html.includes(body), `overlay HTML must include body "${body}"`);
  }
});

test('Slice 93: buildProp supports lantern and planter with worked child geometry, porch remap, tinting, and fallback', () => {
  const THREE = createThreeStub();

  const lantern = buildProp(THREE, {
    kind: 'lantern',
    x: -1.8,
    y: 0,
    z: 0,
    rot_y: 90,
    color: '#6b492b',
  });
  assert.ok(lantern);
  assert.equal(lantern.name, 'prop_lantern');
  assert.equal(lantern.position.x, -1.8);
  assert.ok(Math.abs(lantern.position.y - 0.18) < 1e-12, 'interior z must lift lantern by PORCH_FLOOR_Y 0.18');
  assert.ok(lantern.position.z >= 2.05 && lantern.position.z <= 3.45, 'interior z must remap into [2.05, 3.45]');
  assert.ok(Math.abs(lantern.position.z - 2.75) < 1e-12, 'z=0 remaps to midpoint 2.75');
  assert.ok(Math.abs(lantern.rotation.y - Math.PI / 2) < 1e-12);
  assert.equal(lantern.children.length, 3);

  const post = lantern.children.find((c) => c.name === 'prop_lantern_post');
  assert.ok(post);
  assert.equal(post.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    [post.geometry.parameters.width, post.geometry.parameters.height, post.geometry.parameters.depth],
    [0.08, 0.9, 0.08]
  );
  assert.equal(post.material.color, '#6b492b');
  assert.equal(post.position.x, 0);
  assert.equal(post.position.y, 0.45);
  assert.equal(post.position.z, 0);

  const glass = lantern.children.find((c) => c.name === 'prop_lantern_glass');
  assert.ok(glass);
  assert.equal(glass.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    [glass.geometry.parameters.width, glass.geometry.parameters.height, glass.geometry.parameters.depth],
    [0.16, 0.24, 0.16]
  );
  assert.equal(glass.material.color, '#ffbe5c');
  assert.equal(glass.material.emissive, '#ffbe5c');
  assert.equal(glass.material.emissiveIntensity, 1.4);
  assert.equal(glass.position.x, 0);
  assert.equal(glass.position.y, 0.78);
  assert.equal(glass.position.z, 0);

  const cap = lantern.children.find((c) => c.name === 'prop_lantern_cap');
  assert.ok(cap);
  assert.equal(cap.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    [cap.geometry.parameters.width, cap.geometry.parameters.height, cap.geometry.parameters.depth],
    [0.2, 0.05, 0.2]
  );
  assert.equal(cap.material.color, '#6b492b');
  assert.equal(cap.position.x, 0);
  assert.equal(cap.position.y, 0.93);
  assert.equal(cap.position.z, 0);

  const planter = buildProp(THREE, {
    kind: 'planter',
    x: 1.5,
    y: 0,
    z: 2.5,
    rot_y: 180,
    color: '#7a5230',
  });
  assert.ok(planter);
  assert.equal(planter.name, 'prop_planter');
  assert.equal(planter.position.x, 1.5);
  assert.ok(Math.abs(planter.position.y - 0.18) < 1e-12);
  assert.equal(planter.position.z, 2.5);
  assert.ok(Math.abs(planter.rotation.y - Math.PI) < 1e-12);
  assert.equal(planter.children.length, 5);

  const box = planter.children.find((c) => c.name === 'prop_planter_box');
  assert.ok(box);
  assert.equal(box.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    [box.geometry.parameters.width, box.geometry.parameters.height, box.geometry.parameters.depth],
    [0.6, 0.3, 0.4]
  );
  assert.equal(box.material.color, '#7a5230');
  assert.equal(box.position.x, 0);
  assert.equal(box.position.y, 0.15);
  assert.equal(box.position.z, 0);

  const soil = planter.children.find((c) => c.name === 'prop_planter_soil');
  assert.ok(soil);
  assert.equal(soil.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    [soil.geometry.parameters.width, soil.geometry.parameters.height, soil.geometry.parameters.depth],
    [0.54, 0.04, 0.34]
  );
  assert.equal(soil.material.color, '#4d3522');
  assert.equal(soil.position.x, 0);
  assert.equal(soil.position.y, 0.30);
  assert.equal(soil.position.z, 0);

  const foliages = planter.children
    .filter((c) => c.name === 'prop_planter_foliage')
    .sort((a, b) => a.position.x - b.position.x);
  assert.equal(foliages.length, 3);
  for (const [idx, expectedX] of [[0, -0.18], [1, 0], [2, 0.18]]) {
    const f = foliages[idx];
    assert.equal(f.geometry.type, 'ConeGeometry');
    assert.deepEqual(
      [f.geometry.parameters.radius, f.geometry.parameters.height, f.geometry.parameters.radialSegments],
      [0.12, 0.35, 6]
    );
    assert.equal(f.material.color, '#1f3f26');
    assert.equal(f.position.x, expectedX);
    assert.equal(f.position.y, 0.48);
    assert.equal(f.position.z, 0);
  }

  // Invalid color falls back to #8a6240 on wood parts while fixed colors stay fixed
  const fallbackLantern = buildProp(THREE, { kind: 'lantern', x: 0, y: 0, z: 2.2, rot_y: 0, color: 'bad' });
  assert.equal(fallbackLantern.children.find((c) => c.name === 'prop_lantern_post').material.color, '#8a6240');
  assert.equal(fallbackLantern.children.find((c) => c.name === 'prop_lantern_cap').material.color, '#8a6240');
  assert.equal(fallbackLantern.children.find((c) => c.name === 'prop_lantern_glass').material.color, '#ffbe5c');

  const fallbackPlanter = buildProp(THREE, { kind: 'planter', x: 0, y: 0, z: 2.2, rot_y: 0, color: 'bad' });
  assert.equal(fallbackPlanter.children.find((c) => c.name === 'prop_planter_box').material.color, '#8a6240');
  assert.equal(fallbackPlanter.children.find((c) => c.name === 'prop_planter_soil').material.color, '#4d3522');
  assert.equal(fallbackPlanter.children.find((c) => c.name === 'prop_planter_foliage').material.color, '#1f3f26');

  // Unknown kind still returns null
  assert.equal(buildProp(THREE, { kind: 'fountain', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#ffffff' }), null);
});

test('Slice 410 G1: TOWN_LAYOUT exact constants and computed 8-plot arc', () => {
  assert.deepEqual(TOWN_LAYOUT, {
    clearingRadius: 30,
    bandstand: { x: 0, y: 0, z: 0, radius: 4.5, height: 0.6 },
    gate: { x: 0, y: 0, z: 27 },
    newsstand: { x: 6, y: 0, z: 14 },
    noticeBoard: { x: -6, y: 0, z: 14 },
    inn: { x: -11, y: 0, z: 20 },
    plotRadius: 18.5,
    plots: [
      { plotNumber: 1, x: 17.919, y: 0, z: 4.601, rotY: -1.8221 },
      { plotNumber: 2, x: 17.833, y: 0, z: -4.922, rotY: -1.3015 },
      { plotNumber: 3, x: 13.023, y: 0, z: -13.14, rotY: -0.7809 },
      { plotNumber: 4, x: 4.761, y: 0, z: -17.877, rotY: -0.2603 },
      { plotNumber: 5, x: -4.761, y: 0, z: -17.877, rotY: 0.2603 },
      { plotNumber: 6, x: -13.023, y: 0, z: -13.14, rotY: 0.7809 },
      { plotNumber: 7, x: -17.833, y: 0, z: -4.922, rotY: 1.3015 },
      { plotNumber: 8, x: -17.919, y: 0, z: 4.601, rotY: 1.8221 },
    ],
  });
});

test('Slice 410 G2: footlight palettes via buildTown and applyState', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });

  const fl0 = town.parts.footlights[0];
  assert.equal(fl0.userData.slot, 0);
  assert.equal(fl0.userData.shell.material.color, '#bfeaff');
  assert.equal(fl0.userData.shell.material.emissive, '#9be0ff');
  assert.equal(fl0.userData.shell.material.emissiveIntensity, 0.9);
  assert.equal(fl0.userData.lit, true);
  assert.equal(fl0.userData.handle, 'milo');
  assert.equal(fl0.userData.role, 'muse');
  assert.equal(fl0.userData.permanent, true);
  assert.equal(fl0.userData.placard.rotation.x, -0.55);
  assert.equal(fl0.userData.placard.position.y, 0.14);

  applyState(town, { footlights: [{ handle: 'wick', slot: 1, role: 'npc' }] });
  const fl1 = town.parts.footlights[1];
  assert.equal(fl1.userData.shell.material.color, '#ffbe55');
  assert.equal(fl1.userData.shell.material.emissive, '#ffaa33');
  assert.equal(fl1.userData.shell.material.emissiveIntensity, 1.0);
  assert.equal(fl1.userData.lit, true);
  assert.equal(fl1.userData.handle, 'wick');
  assert.equal(fl1.userData.role, 'npc');

  applyState(town, { footlights: [{ handle: 'milo', slot: 3, role: 'muse' }] });
  const fl3 = town.parts.footlights[3];
  assert.equal(fl3.userData.shell.material.color, '#7a6230');
  assert.equal(fl3.userData.shell.material.emissive, '#000000');
  assert.equal(fl3.userData.shell.material.emissiveIntensity, 0);
  assert.equal(fl3.userData.lit, false);
  assert.equal(fl3.userData.handle, null);
  assert.equal(fl3.userData.placard.rotation.x, 0);
  assert.equal(fl3.userData.placard.position.y, 0.06);
  assert.equal(fl3.userData.placard.material.map, null);
  assert.equal(fl3.userData.placard.material.color, '#4d301c');
  assert.equal(fl0.userData.lit, true);
  assert.equal(fl0.userData.handle, 'milo');
});

test('Slice 410 G3: formatPromptBookEntries normalization, coercion, defaults, and 100-line cap', () => {
  assert.deepEqual(formatPromptBookEntries(null), []);
  assert.deepEqual(formatPromptBookEntries('nope'), []);

  assert.deepEqual(formatPromptBookEntries([{ handle: 'muse', body: 'hi' }]), [
    { id: null, handle: 'muse', kind: 'say', body: 'hi', reply_to: null, created_at: 0, role: 'muse' },
  ]);

  assert.deepEqual(
    formatPromptBookEntries([
      { kind: 'emote', role: 'npc', handle: 'wick', body: 'bows', reply_to: 4, created_at: 99, id: 7 },
    ]),
    [{ id: 7, handle: 'wick', kind: 'emote', body: 'bows', reply_to: 4, created_at: 99, role: 'npc' }]
  );

  assert.equal(formatPromptBookEntries([{ handle: 'muse', body: 'a', kind: 'shout' }])[0].kind, 'say');
  assert.equal(formatPromptBookEntries([{ handle: 'muse', body: 'a', kind: 'system' }])[0].kind, 'system');

  assert.equal(formatPromptBookEntries([{ handle: 'muse', body: 'a', role: 'guest' }])[0].role, 'guest');
  assert.equal(formatPromptBookEntries([{ handle: 'muse', body: 'a', role: 'wizard' }])[0].role, 'muse');

  assert.equal(formatPromptBookEntries([{ handle: 'muse', body: 'a', reply_to: 2.5 }])[0].reply_to, null);
  assert.equal(formatPromptBookEntries([{ handle: 'muse', body: 'a', reply_to: '3' }])[0].reply_to, null);

  const def = formatPromptBookEntries([{ handle: 42, body: 7 }])[0];
  assert.equal(def.handle, 'unknown');
  assert.equal(def.body, '');

  const rows105 = Array.from({ length: 105 }, (_, i) => ({
    id: i + 1,
    handle: 'muse',
    body: 'line ' + (i + 1),
  }));
  const capped = formatPromptBookEntries(rows105);
  assert.equal(capped.length, 100);
  assert.equal(capped[0].id, 6);
  assert.equal(capped[99].id, 105);

  const exact100 = formatPromptBookEntries(rows105.slice(0, 100));
  assert.equal(exact100.length, 100);
});

test('Slice 410 G4: getPlotTargetPosition exact coordinates for plot 1 indices 0..3', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  assert.deepEqual(getPlotTargetPosition(plot1, 0), { x: 14.4321, y: 0, z: 3.7058, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(plot1, 1), { x: 14.2083, y: 0, z: 4.5775, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(plot1, 2), { x: 14.6559, y: 0, z: 2.8341, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(plot1, 3), { x: 13.9845, y: 0, z: 5.4493, rotY: -1.8221 });
});

test('Slice 410 G5: buildProp single-mesh geometry, porch remap, validation, and color fallback', () => {
  const THREE = createThreeStub();
  const base = { x: 1, y: 0, z: 3.0, rot_y: 90, color: '#aabbcc' };
  const cases = [
    ['desk', 'BoxGeometry', { width: 1.1, height: 0.72, depth: 0.6 }, [1, 0.54, 3]],
    ['bookshelf', 'BoxGeometry', { width: 0.9, height: 1.4, depth: 0.35 }, [1, 0.18 + 0.7, 3]],
    ['rug', 'BoxGeometry', { width: 1.6, height: 0.04, depth: 1.1 }, [1, 0.18 + 0.02, 3]],
    ['tea_kettle', 'CylinderGeometry', { radiusTop: 0.14, radiusBottom: 0.18, height: 0.24, radialSegments: 8 }, [1, 0.3, 3]],
    ['typewriter', 'BoxGeometry', { width: 0.36, height: 0.18, depth: 0.3 }, [1, 0.27, 3]],
    ['cat', 'ConeGeometry', { radius: 0.16, height: 0.36, radialSegments: 6 }, [1, 0.36, 3]],
    ['poster_frame', 'BoxGeometry', { width: 0.7, height: 0.9, depth: 0.06 }, [1, 1.08, 3]],
  ];

  for (const [kind, geomType, params, pos] of cases) {
    const mesh = buildProp(THREE, { ...base, kind });
    assert.ok(mesh, `buildProp should build ${kind}`);
    assert.equal(mesh.name, `prop_${kind}`);
    assert.equal(mesh.rotation.y, Math.PI / 2);
    assert.equal(mesh.geometry.type, geomType);
    assert.deepEqual(mesh.geometry.parameters, params);
    assert.deepEqual([mesh.position.x, mesh.position.y, mesh.position.z], pos);
  }

  // Porch remap for interior z values
  const z0 = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, color: '#aabbcc' });
  assert.equal(z0.position.z, 2.75);
  assert.equal(z0.position.y, 0.54);
  const zNeg2 = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: -2, rot_y: 0, color: '#aabbcc' });
  assert.equal(zNeg2.position.z, 3.45);
  const zPos2 = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2, rot_y: 0, color: '#aabbcc' });
  assert.equal(zPos2.position.z, 2.05);

  // Invalid inputs return null
  assert.equal(buildProp(THREE, null), null);
  assert.equal(buildProp(THREE, { ...base, kind: 'fountain' }), null);
  assert.equal(buildProp(THREE, { ...base, kind: 'desk', x: 13 }), null);
  assert.equal(buildProp(THREE, { ...base, kind: 'desk', rot_y: 360 }), null);
  assert.equal(buildProp(THREE, { ...base, kind: 'desk', rot_y: -1 }), null);
  assert.equal(buildProp(THREE, { ...base, kind: 'desk', x: NaN }), null);

  // Bad color falls back to #8a6240
  const badColor = buildProp(THREE, { ...base, kind: 'desk', color: 'red' });
  assert.equal(badColor.material.color, '#8a6240');
});

test('Slice 410 G6: inn room windows claimed, vacant, empty, and missing-state preservation', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const { roomWindows, commonWindowMaterial } = town.parts.inn.userData;

  assert.deepEqual(Object.keys(roomWindows).sort(), ['lantern', 'quiet', 'window']);
  assert.equal(roomWindows.lantern.name, 'inn_window_4');
  assert.equal(roomWindows.window.name, 'inn_window_5');
  assert.equal(roomWindows.quiet.name, 'inn_window_6');

  assert.equal(roomWindows.lantern.material.color, '#ffbe5c');
  assert.equal(roomWindows.lantern.material.emissive, '#ffbe5c');
  assert.equal(roomWindows.lantern.material.emissiveIntensity, 1.4);
  assert.equal(commonWindowMaterial.color, '#ffbe5c');

  applyState(town, {
    inn: {
      lantern: { handle: 'a', room: 'lantern' },
      window: null,
      quiet: { handle: 'b', room: 'quiet' },
    },
  });
  assert.equal(roomWindows.lantern.material.emissiveIntensity, 1.4);
  assert.equal(roomWindows.window.material.color, '#3d2814');
  assert.equal(roomWindows.window.material.emissive, '#4a2e10');
  assert.equal(roomWindows.window.material.emissiveIntensity, 0.15);
  assert.equal(roomWindows.quiet.material.emissiveIntensity, 1.4);
  assert.equal(commonWindowMaterial.emissiveIntensity, 1.4);

  applyState(town, { inn: {} });
  assert.equal(roomWindows.lantern.material.emissiveIntensity, 0.15);
  assert.equal(commonWindowMaterial.emissiveIntensity, 0.15);
  assert.equal(commonWindowMaterial.color, '#3d2814');

  const town2 = buildTown(THREE, { loadProps: false });
  applyState(town2, {});
  assert.equal(town2.parts.inn.userData.roomWindows.lantern.material.emissiveIntensity, 1.4);
  assert.equal(town2.parts.inn.userData.commonWindowMaterial.emissiveIntensity, 1.4);
});

test('Slice 410 G7: applyPlotManifest guards, seed pad pinning, stranger assignment, and re-apply replacement', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const wickManifest = {
    cottage: 'cabin',
    wall: '#c9a06a',
    roof: '#5a4332',
    trim: '#f5efe0',
    label: 'Wick — Plot 2',
    props: [],
  };

  assert.equal(applyPlotManifest(town, 'milo', MILO_REBUILD_MANIFEST), null);
  assert.equal(applyPlotManifest(town, 'wick', null), null);
  assert.equal(applyPlotManifest(null, 'wick', wickManifest), null);

  const wick1 = applyPlotManifest(town, 'wick', wickManifest);
  assert.ok(wick1);
  assert.equal(wick1.name, 'cottage_wick');
  assert.equal(wick1.userData.handle, 'wick');
  assert.equal(wick1.userData.plotNumber, 2);
  assert.equal(wick1.userData.clickable, true);
  assert.equal(wick1.userData.kind, 'cottage');
  assert.equal(wick1.position.x, TOWN_LAYOUT.plots[1].x);
  assert.equal(wick1.position.z, TOWN_LAYOUT.plots[1].z);
  assert.equal(wick1.rotation.y, TOWN_LAYOUT.plots[1].rotY);
  assert.equal(town.scene.children.some((c) => c.name === 'plot_pad_2'), false);

  const lampmoth = applyPlotManifest(town, 'lampmoth', {
    cottage: 'gable',
    wall: '#ffffff',
    roof: '#333333',
    trim: '#eeeeee',
    label: 'Lampmoth',
    props: [],
  });
  assert.ok(lampmoth);
  assert.equal(lampmoth.userData.plotNumber, 5);
  assert.equal(lampmoth.name, 'cottage_lampmoth');

  const wick2 = applyPlotManifest(town, 'wick', { ...wickManifest, label: 'Wick — Plot 2 (v2)' });
  assert.ok(wick2);
  assert.notEqual(wick2, wick1);
  assert.equal(town.scene.children.filter((c) => c.name === 'cottage_wick').length, 1);
  assert.equal(town.scene.children.includes(wick1), false);
});

test('Slice 410 G8: createAvatarCapsule exact geometry, NPC lift, and role normalization', () => {
  const THREE = createThreeStub();
  const av = createAvatarCapsule(THREE, { handle: 'muse', role: 'muse' });
  assert.equal(av.name, 'avatar_muse');
  assert.equal(av.userData.handle, 'muse');
  assert.equal(av.userData.role, 'muse');
  assert.equal(av.userData.nametagLift, 0);
  assert.equal(av.userData.nametagSprite, av.children[2]);

  const body = av.children[0];
  assert.equal(body.geometry.type, 'CylinderGeometry');
  assert.deepEqual(body.geometry.parameters, {
    radiusTop: 0.28,
    radiusBottom: 0.32,
    height: 1.0,
    radialSegments: 8,
  });
  assert.equal(body.position.y, 0.5);
  assert.equal(body.material.color, '#6cb4d8');

  const head = av.children[1];
  assert.equal(head.geometry.type, 'SphereGeometry');
  assert.deepEqual(head.geometry.parameters, {
    radius: 0.24,
    widthSegments: 8,
    heightSegments: 6,
  });
  assert.equal(head.position.y, 1.2);
  assert.equal(head.material.color, '#f2dcc4');

  const sprite = av.children[2];
  assert.equal(sprite.name, 'nametag_sprite');
  assert.equal(sprite.position.y, 1.8);
  assert.deepEqual([sprite.scale.x, sprite.scale.y, sprite.scale.z], [1.5, 0.375, 1]);

  const npc = createAvatarCapsule(THREE, { handle: 'wick', role: 'npc', nametagLift: 0.5 });
  assert.equal(npc.children[0].material.color, '#d49a45');
  assert.equal(npc.userData.role, 'npc');
  assert.equal(npc.children[2].position.y, 2.3);

  const wiz = createAvatarCapsule(THREE, { handle: 'wiz', role: 'wizard' });
  assert.equal(wiz.userData.role, 'muse');
  assert.equal(wiz.children[0].material.color, '#6cb4d8');

  const guest = createAvatarCapsule(THREE, { handle: 'visitor', role: 'guest' });
  assert.equal(guest.userData.role, 'guest');
  assert.equal(guest.children[0].material.color, '#6cb4d8');
});

test('Slice 410 G9: setAvatarStatusText truncation, scale, trimming, and clearing', () => {
  const THREE = createThreeStub();
  const av = createAvatarCapsule(THREE, { handle: 'muse', role: 'muse' });
  const sprite = av.userData.nametagSprite;

  setAvatarStatusText(THREE, av, 'Sweeping the steps');
  assert.equal(av.userData.statusText, 'Sweeping the steps');
  assert.equal(sprite.scale.y, 0.5625);
  assert.equal(sprite.material.needsUpdate, true);

  setAvatarStatusText(THREE, av, 'a'.repeat(30));
  assert.equal(av.userData.statusText, 'a'.repeat(23) + '…');
  assert.equal(av.userData.statusText.length, 24);

  setAvatarStatusText(THREE, av, 'a'.repeat(24));
  assert.equal(av.userData.statusText, 'a'.repeat(24));

  setAvatarStatusText(THREE, av, 'a'.repeat(25));
  assert.equal(av.userData.statusText, 'a'.repeat(23) + '…');

  setAvatarStatusText(THREE, av, '');
  assert.equal(av.userData.statusText, null);
  assert.equal(sprite.scale.y, 0.375);

  setAvatarStatusText(THREE, av, 42);
  assert.equal(av.userData.statusText, null);

  setAvatarStatusText(THREE, av, '  padded  ');
  assert.equal(av.userData.statusText, 'padded');

  setAvatarStatusText(THREE, av, null);
  assert.equal(av.userData.statusText, null);
});

test('Slice 410 G10: test-3d.mjs file hygiene and pinned needle counts', async () => {
  const src = await fs.readFile(path.join(__dirname, 'test-3d.mjs'), 'utf8');
  const testNames = [...src.matchAll(/^(?:await )?test\((['"])((?:\\.|(?!\1).)*)\1/gm)].map((m) => m[2]);
  assert.equal(testNames.length, 55);
  assert.equal(new Set(testNames).size, 55);

  const importLines = src.match(/^import /gm) || [];
  assert.equal(importLines.length, 6);

  assert.equal(src.includes('TO' + 'DO'), false);
  assert.equal(src.includes('FIX' + 'ME'), false);
  assert.equal(src.includes('Date.' + 'now'), false);
  assert.equal(src.includes('Math.' + 'random'), false);

  assert.equal(src.split('camp' + 'fire').length - 1, 5);
  assert.equal(src.split('fet' + 'ch(').length - 1, 5);
});

test('Slice 472 G1: PROP_PLACEMENTS exact nine placements with coordinates, rotations, and sizes', () => {
  assert.deepEqual(PROP_PLACEMENTS, [
    { id: 'gate_lantern_left', kind: 'post-lantern', model: 'models/post-lantern.glb', parent: 'scene', x: -3.2, y: 0, z: 26.2, rotY: 0, targetSize: 2.2, scaleAxis: 'y' },
    { id: 'gate_lantern_right', kind: 'post-lantern', model: 'models/post-lantern.glb', parent: 'scene', x: 3.2, y: 0, z: 26.2, rotY: 0, targetSize: 2.2, scaleAxis: 'y' },
    { id: 'bandstand_bench', kind: 'bench', model: 'models/bench.glb', parent: 'scene', x: -6.2, y: 0, z: 5.5, rotY: 2.2964, targetSize: 1.8, scaleAxis: 'length' },
    { id: 'newsstand_lantern', kind: 'lantern', model: 'models/lantern.glb', parent: 'newsstand', x: 0.65, y: 1.03, z: 0.78, rotY: 0, targetSize: 0.35, scaleAxis: 'y' },
    { id: 'newsstand_street_light', kind: 'street-light', model: 'models/street-light.glb', parent: 'scene', x: 7.8, y: 0, z: 15.2, rotY: 0, targetSize: 3, scaleAxis: 'y' },
    { id: 'newsstand_bookshelf', kind: 'bookshelf', model: 'models/bookshelf.glb', parent: 'scene', x: 4.6, y: 0, z: 15, rotY: -2.844, targetSize: 1.6, scaleAxis: 'y' },
    { id: 'wick_oil_lamp', kind: 'oil-lamp', model: 'models/oil-lamp.glb', parent: 'scene', x: 14.41, y: 0, z: -6.05, rotY: -1.1733, targetSize: 0.9, scaleAxis: 'y' },
    { id: 'tomas_teapot', kind: 'teapot', model: 'models/teapot.glb', parent: 'scene', x: 2.06, y: 0, z: -15.49, rotY: -0.1322, targetSize: 0.9, scaleAxis: 'y' },
    { id: 'maren_typewriter', kind: 'typewriter', parent: 'scene', x: 9.49, y: 0, z: -12.42, rotY: -0.6525 },
  ]);
  assert.equal(PROP_PLACEMENTS.filter((p) => p.model).length, 8);
  assert.deepEqual(PROP_PLACEMENTS.filter((p) => !p.model).map((p) => p.id), ['maren_typewriter']);
  assert.equal(new Set(PROP_PLACEMENTS.map((p) => p.id)).size, 9);
});

test('Slice 472 G2: FOOTLIGHT_COLORS exact palettes and lit-intensity cap', () => {
  assert.deepEqual(FOOTLIGHT_COLORS, {
    muse: { color: '#bfeaff', emissive: '#9be0ff', emissiveIntensity: 0.9 },
    npc: { color: '#ffbe55', emissive: '#ffaa33', emissiveIntensity: 1.0 },
    unlit: { color: '#7a6230', emissive: '#000000', emissiveIntensity: 0 },
  });
  assert.ok(FOOTLIGHT_COLORS.muse.emissiveIntensity <= 1.0);
  assert.ok(FOOTLIGHT_COLORS.npc.emissiveIntensity <= 1.0);
  assert.equal(FOOTLIGHT_COLORS.unlit.emissiveIntensity, 0);
  assert.equal(FOOTLIGHT_COLORS.muse.emissiveIntensity, 0.9);
  assert.equal(FOOTLIGHT_COLORS.npc.emissiveIntensity, 1.0);
});

test('Slice 472 G3: INN_ROOM_WINDOWS and INN_WINDOW_COLORS exact room and palette constants', () => {
  assert.deepEqual(INN_ROOM_WINDOWS, { lantern: 4, window: 5, quiet: 6 });
  assert.deepEqual(INN_WINDOW_COLORS, {
    claimed: { color: '#ffbe5c', emissive: '#ffbe5c', emissiveIntensity: 1.4 },
    vacant: { color: '#3d2814', emissive: '#4a2e10', emissiveIntensity: 0.15 },
  });
  assert.deepEqual(Object.keys(INN_ROOM_WINDOWS).sort(), ['lantern', 'quiet', 'window']);
});

test('Slice 472 G4: MILO_REBUILD_MANIFEST exact rebuild cottage and props', () => {
  assert.deepEqual(MILO_REBUILD_MANIFEST, {
    cottage: 'gable',
    wall: '#a8d8ea',
    roof: '#5a4332',
    trim: '#f5efe0',
    signpost_text: 'Milo — Ghostlight Cottage (rebuilt)',
    props: [
      { kind: 'desk', x: -1.2, y: 0, z: 2.2, rot_y: 180, color: '#7a5230' },
      { kind: 'tea_kettle', x: -1.0, y: 0.78, z: 2.2, rot_y: 45, color: '#b87333' },
      { kind: 'cat', x: 1.3, y: 0, z: 2.1, rot_y: 210, color: '#2b2b2b' },
    ],
  });
});

test('Slice 472 G5: formatPlotGuestbookTabLabel exact labels for zero, counts, and bad input', () => {
  assert.equal(formatPlotGuestbookTabLabel(0), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(1), 'Guestbook (1)');
  assert.equal(formatPlotGuestbookTabLabel(2), 'Guestbook (2)');
  assert.equal(formatPlotGuestbookTabLabel(12), 'Guestbook (12)');
  assert.equal(formatPlotGuestbookTabLabel(undefined), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(NaN), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(-1), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel('7'), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(null), 'Guestbook');
});

test('Slice 472 G6: wander figures carry exact seed speeds, lingers, and Milo deck waypoints', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const figs = town._wander.figures;
  assert.equal(figs.length, 4);
  const byHandle = Object.fromEntries(figs.map((f) => [f.handle, f]));

  for (const [handle, speed, lingers, slot] of [
    ['wick', 0.5, [10, 14, 12], 1],
    ['maren', 0.45, [12, 16, 10], 2],
    ['tomas', 0.6, [9, 12, 15], 3],
  ]) {
    const f = byHandle[handle];
    assert.equal(f.speed, speed);
    assert.deepEqual(f.waypoints.map((w) => w.linger), lingers);
    assert.deepEqual(f.waypoints.map((w) => w.label), ['home', 'bandstand', 'newsstand']);
    assert.equal(f.targetIndex, 1);
    assert.equal(f.state, 'walking');
    assert.equal(f.yielded, false);
    const spot = town.parts.avatarSpots[slot];
    assert.equal(f.waypoints[1].x, spot.x);
    assert.equal(f.waypoints[1].y, spot.y);
    assert.equal(f.waypoints[1].z, spot.z);
  }

  const milo = byHandle.milo;
  assert.equal(milo.speed, 0.35);
  assert.deepEqual(milo.waypoints, [
    { x: 0, y: 0.6, z: 4.5, linger: 25, label: 'spot0' },
    { x: -2.2, y: 0.6, z: 1.6, linger: 8, label: 'deck1' },
    { x: 0.4, y: 0.6, z: -2.4, linger: 10, label: 'deck2' },
    { x: 2.3, y: 0.6, z: 1.4, linger: 8, label: 'deck3' },
  ]);
  assert.equal(milo.targetIndex, 1);
  assert.equal(milo.state, 'walking');
  assert.equal(milo.yielded, false);
});

test('Slice 472 G7: updateNightlyCallCard sets, dedupes, and ignores malformed topics', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const card = town.parts.nightlyCallCard;
  assert.ok(card && card.material);
  const map0 = card.material.map;
  assert.ok(map0 && map0.type === 'CanvasTexture');

  const topic = 'What do you notice first when you step out at night?';
  updateNightlyCallCard(town, { topic });
  const map1 = card.material.map;
  assert.ok(map1 && map1.type === 'CanvasTexture');
  assert.notEqual(map1, map0);
  assert.equal(card.material.needsUpdate, true);

  updateNightlyCallCard(town, { topic });
  assert.equal(card.material.map, map1);

  const longTopic = 'What small sound tells you the town is awake before anyone else has stirred from their cottage door?';
  assert.ok(longTopic.length > 60);
  updateNightlyCallCard(town, { topic: longTopic });
  const mapLong = card.material.map;
  assert.notEqual(mapLong, map1);
  assert.equal(mapLong.type, 'CanvasTexture');

  for (const bad of [null, undefined, 'just a string', {}, { topic: 42 }, { topic: '   ' }, [], { topic: null }]) {
    updateNightlyCallCard(town, bad);
    assert.equal(card.material.map, mapLong);
  }
  assert.doesNotThrow(() => updateNightlyCallCard(null, { topic }));
});

test('Slice 472 G8: getPlotTargetPosition exact coordinates for plots 2..8 and plot 5 lateral offsets', () => {
  const expected = {
    2: { x: 14.3627, y: 0, z: -3.9642, rotY: -1.3015 },
    3: { x: 10.4889, y: 0, z: -10.583, rotY: -0.7809 },
    4: { x: 3.8345, y: 0, z: -14.3983, rotY: -0.2603 },
    5: { x: -3.8345, y: 0, z: -14.3983, rotY: 0.2603 },
    6: { x: -10.4889, y: 0, z: -10.583, rotY: 0.7809 },
    7: { x: -14.3627, y: 0, z: -3.9642, rotY: 1.3015 },
    8: { x: -14.4321, y: 0, z: 3.7058, rotY: 1.8221 },
  };
  for (let n = 2; n <= 8; n++) {
    const layout = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === n);
    assert.deepEqual(getPlotTargetPosition(layout, 0), expected[n]);
  }
  const p5 = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === 5);
  assert.deepEqual(getPlotTargetPosition(p5, 1), { x: -2.9648, y: 0, z: -14.6299, rotY: 0.2603 });
  assert.deepEqual(getPlotTargetPosition(p5, 2), { x: -4.7041, y: 0, z: -14.1666, rotY: 0.2603 });
  assert.deepEqual(getPlotTargetPosition(p5, 3), { x: -2.0951, y: 0, z: -14.8615, rotY: 0.2603 });
});

test('Slice 472 G9: fitModelToTarget scales by axis, centers on the ground, and ignores zero-size models', () => {
  const THREE = createThreeStub();
  const stubModel = (min, max) => {
    const m = new THREE.Group();
    m.userData.stubBounds = { min, max };
    return m;
  };

  const m1 = stubModel([-2, 1, -1], [2, 5, 1]);
  assert.equal(fitModelToTarget(THREE, m1, 2, 'y'), m1);
  assert.deepEqual({ x: m1.scale.x, y: m1.scale.y, z: m1.scale.z }, { x: 0.5, y: 0.5, z: 0.5 });
  assert.ok(m1.position.x === 0 && m1.position.y === -0.5 && m1.position.z === 0);

  const m2 = stubModel([-2, 1, -1], [2, 5, 1]);
  fitModelToTarget(THREE, m2, 1, 'x');
  assert.equal(m2.scale.x, 0.25);
  assert.equal(m2.position.y, -0.25);

  const m3 = stubModel([-2, 1, -1], [2, 5, 1]);
  fitModelToTarget(THREE, m3, 2, 'length');
  assert.equal(m3.scale.x, 0.5);

  const m4 = stubModel([-1, 0, -2], [1, 1, 2]);
  fitModelToTarget(THREE, m4, 3, 'max');
  assert.equal(m4.scale.x, 0.75);

  const m5 = stubModel([1, 2, 3], [1, 2, 3]);
  const beforeScale = { x: m5.scale.x, y: m5.scale.y, z: m5.scale.z };
  const beforePos = { x: m5.position.x, y: m5.position.y, z: m5.position.z };
  assert.equal(fitModelToTarget(THREE, m5, 2, 'y'), m5);
  assert.deepEqual({ x: m5.scale.x, y: m5.scale.y, z: m5.scale.z }, beforeScale);
  assert.deepEqual({ x: m5.position.x, y: m5.position.y, z: m5.position.z }, beforePos);

  const m6 = stubModel([-1, 0, -1], [1, 2, 1]);
  fitModelToTarget(THREE, m6, 4);
  assert.equal(m6.scale.x, 2);
});

test('Slice 472 G10: resolveGuestbookOverlayContent serves API entries and falls back to static', async () => {
  let calledUrl = null;
  const fakeFetch = async (url) => {
    calledUrl = url;
    return {
      status: 200,
      json: async () => ({ entries: [
        { kind: 'guestbook', name: 'Ada <b>Bold</b>', body: 'Hello & welcome <script>', created_at: 1764028800 },
        { kind: 'letter', name: 'Bo', body: 'A quiet note.', created_at: null },
        { kind: 'other', name: 'Ignored', body: 'Not shown.' },
      ] }),
    };
  };
  const r1 = await resolveGuestbookOverlayContent({ fetchFn: fakeFetch, apiBase: 'https://x.test/' });
  assert.equal(r1.kind, 'api');
  assert.equal(calledUrl, 'https://x.test/api/town/guestbook?limit=50');
  assert.ok(r1.html.includes('Ada &lt;b&gt;Bold&lt;/b&gt;'));
  assert.ok(!r1.html.includes('Ada <b>Bold</b>'));
  assert.ok(r1.html.includes('Hello &amp; welcome &lt;script&gt;'));
  assert.ok(!r1.html.includes('<script>'));
  assert.ok(r1.html.includes('A quiet note.'));
  assert.ok(!r1.html.includes('Not shown.'));
  assert.ok(r1.html.includes('Nov 24, 2025'));

  const notFound = async () => ({ status: 404, json: async () => ({}) });
  const r2 = await resolveGuestbookOverlayContent({ fetchFn: notFound, apiBase: '' });
  assert.equal(r2.kind, 'static');
  assert.equal(r2.url, 'guestbook/index.html');

  const throwing = async () => { throw new Error('down'); };
  const r3 = await resolveGuestbookOverlayContent({ fetchFn: throwing, apiBase: '' });
  assert.equal(r3.kind, 'static');
  assert.equal(r3.url, 'guestbook/index.html');

  const nonArray = async () => ({ status: 200, json: async () => ({ entries: 'nope' }) });
  const r4 = await resolveGuestbookOverlayContent({ fetchFn: nonArray, apiBase: '' });
  assert.equal(r4.kind, 'static');

  const r5 = await resolveGuestbookOverlayContent({});
  assert.equal(r5.kind, 'static');
  assert.equal(r5.url, 'guestbook/index.html');

  const empty = async () => ({ status: 200, json: async () => ({ entries: [] }) });
  const r6 = await resolveGuestbookOverlayContent({ fetchFn: empty, apiBase: '' });
  assert.equal(r6.kind, 'api');
  assert.ok(r6.html.includes('No signatures yet'));
});
